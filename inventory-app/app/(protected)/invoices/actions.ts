'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { ActionResult } from '@/lib/action-result';
import { actionError } from '@/lib/action-result';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { financeError } from '@/lib/finance/errors';
import {
  CreateManualInvoiceSchema,
  ReviseInvoiceSchema,
  UpdateInvoiceDraftSchema,
} from '@/lib/finance/invoice-schemas';
import { ConfirmManualRefundSchema, CreateCreditRefundSchema, RecordPaymentSchema, RetryRefundSchema, ReversePaymentSchema } from '@/lib/finance/validation';
import type { InvoiceResult } from '@/lib/finance/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { invoiceDocumentFromDetail } from '@/lib/documents/invoice-types';
import { renderInvoicePdf } from '@/lib/documents/render-invoice-pdf';
import { sendInvoiceEmail } from '@/lib/email/invoice-email';
import { getInvoiceDetail } from '@/lib/finance/queries';

function revalidateInvoice(invoiceId?: string, jobId?: string) {
  revalidatePath('/invoices');
  revalidatePath('/receivables');
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
  if (jobId) {
    revalidatePath('/jobs');
    revalidatePath(`/jobs/${jobId}`);
  }
}

/** Explicit invoice for an already-completed job. Never touches stock. */
export async function createInvoiceFromJobAction(jobId: string): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to create invoices.');
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('create_invoice_from_job', {
    p_request_id: randomUUID(),
    p_job_id: jobId,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(data.invoice_id, jobId);
  // Navigate server-side: a client-side push would race the job-page
  // revalidation, which unmounts the button before its effect can run.
  redirect(`/invoices/${data.invoice_id}`);
}

/** Atomic complete + invoice: one database transaction, all-or-nothing. */
export async function completeJobAndCreateInvoiceAction(
  jobId: string,
  expectedVersion: number,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'jobs.complete') || !hasPermission(access, 'invoices.create')) {
    return actionError('You do not have permission to complete and invoice this job.');
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('complete_job_and_create_invoice', {
    p_request_id: randomUUID(),
    p_job_id: jobId,
    p_expected_version: expectedVersion,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(data.invoice_id, jobId);
  redirect(`/invoices/${data.invoice_id}`);
}

export async function createManualInvoiceAction(
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to create invoices.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return actionError('The invoice form could not be read. Please retry.');
  }
  const parsed = CreateManualInvoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return actionError('Please check the invoice details and try again.', parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  // Managers are pinned to their own branch; only an Admin may choose one.
  const locationId = access.role === 'admin' ? parsed.data.location_id : access.locationId;
  if (!locationId) return actionError('Select a branch for this invoice.');
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('create_manual_invoice_v2', {
    p_request_id: parsed.data.request_id,
    p_location_id: locationId,
    p_input: {
      ...parsed.data,
      request_id: undefined,
      location_id: undefined,
    },
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(data.invoice_id);
  redirect(`/invoices/${data.invoice_id}`);
}

export async function updateInvoiceDraftAction(
  invoiceId: string,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.edit') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to edit invoices.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return actionError('The invoice form could not be read. Please retry.');
  }
  const parsed = UpdateInvoiceDraftSchema.safeParse(raw);
  if (!parsed.success) return actionError('Please check the invoice details and try again.');
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('update_invoice_draft_v2', {
    p_request_id: parsed.data.request_id,
    p_invoice_id: invoiceId,
    p_expected_version: parsed.data.expected_version,
    p_input: { ...parsed.data, request_id: undefined, expected_version: undefined },
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  redirect(`/invoices/${invoiceId}`);
}

export async function reviseUnpaidInvoiceAction(
  invoiceId: string,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (
    !hasPermission(access, 'invoices.edit') ||
    !hasPermission(access, 'invoices.issue') ||
    !hasPermission(access, 'invoices.view')
  ) {
    return actionError('You do not have permission to revise invoices.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return actionError('The invoice form could not be read. Please retry.');
  }
  const parsed = ReviseInvoiceSchema.safeParse(raw);
  if (!parsed.success) return actionError('A reason is required to revise an issued invoice.');
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('revise_unpaid_invoice', {
    p_request_id: randomUUID(),
    p_invoice_id: invoiceId,
    p_expected_version: parsed.data.expected_version,
    p_input: {
      revision_reason: parsed.data.revision_reason,
      payment_terms: parsed.data.payment_terms ?? null,
      customer_reference: parsed.data.customer_reference ?? null,
      customer_notes: parsed.data.customer_notes ?? null,
      lines: parsed.data.lines ?? [],
    },
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  redirect(`/invoices/${invoiceId}`);
}

export async function issueInvoiceAction(
  invoiceId: string,
  expectedVersion: number,
  requestId?: string,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.issue') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to issue invoices.');
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('issue_invoice', {
    p_request_id: requestId ?? randomUUID(),
    p_invoice_id: invoiceId,
    p_expected_version: expectedVersion,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as InvoiceResult };
}

export async function duplicateInvoiceAction(
  invoiceId: string,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.view')) return actionError('You do not have permission to duplicate invoices.');
  const requestId = String(formData.get('request_id') ?? '');
  if (!zUuid(requestId)) return actionError('The duplicate request is invalid. Please refresh and retry.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('duplicate_invoice_draft', {
    p_request_id: requestId, p_invoice_id: invoiceId, p_location_id: access.role === 'admin' ? null : access.locationId,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(data.invoice_id);
  redirect(`/invoices/${data.invoice_id}/edit`);
}

export async function voidInvoiceAction(
  invoiceId: string,
  expectedVersion: number,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.cancel') || !hasPermission(access, 'invoices.view')) return actionError('You do not have permission to void invoices.');
  const requestId = String(formData.get('request_id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!zUuid(requestId) || !reason) return actionError('A reason is required to void this invoice.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('void_issued_invoice', {
    p_request_id: requestId, p_invoice_id: invoiceId, p_expected_version: expectedVersion, p_reason: reason,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as InvoiceResult };
}

function zUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function cancelInvoiceAction(
  invoiceId: string,
  expectedVersion: number,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.cancel') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to cancel invoices.');
  }
  const reason = String(formData.get('reason') ?? '').trim();
  const requestId = String(formData.get('request_id') ?? '');
  if (!reason || !zUuid(requestId)) return actionError('A reason is required to cancel an invoice.');
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('cancel_invoice', {
    p_request_id: requestId,
    p_invoice_id: invoiceId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as InvoiceResult };
}

export async function recordInvoicePaymentAction(
  invoiceId: string,
  _prev: ActionResult<{ invoice_id: string; version?: number }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ invoice_id: string; version?: number }>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'payments.record') || !hasPermission(access, 'payments.view')) {
    return actionError('You do not have permission to record payments.');
  }
  const parsed = RecordPaymentSchema.safeParse({
    request_id: String(formData.get('request_id') ?? ''),
    expected_version: Number(formData.get('expected_version')),
    tenders: [{
      method: String(formData.get('method') ?? ''),
      amount: String(formData.get('amount') ?? ''),
      reference: String(formData.get('reference') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      received_at: null,
    }],
  });
  if (!parsed.success) return actionError('Check the payment method and amount.');
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('record_invoice_payment', {
    p_request_id: parsed.data.request_id,
    p_invoice_id: invoiceId,
    p_expected_version: parsed.data.expected_version,
    p_tenders: parsed.data.tenders,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as { invoice_id: string; version?: number } };
}

export async function reverseManualPaymentAction(
  invoiceId: string,
  paymentId: string,
  _prev: ActionResult<{ invoice_id: string; version?: number }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ invoice_id: string; version?: number }>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'payments.reverse') || !hasPermission(access, 'payments.view')) {
    return actionError('You do not have permission to reverse payments.');
  }
  const parsed = ReversePaymentSchema.safeParse({
    request_id: String(formData.get('request_id') ?? ''),
    expected_version: Number(formData.get('expected_version')),
    reason: String(formData.get('reason') ?? ''),
  });
  if (!parsed.success) return actionError('Enter a reason for reversing this payment.');
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('reverse_manual_payment', {
    p_request_id: parsed.data.request_id,
    p_invoice_id: invoiceId,
    p_payment_id: paymentId,
    p_expected_version: parsed.data.expected_version,
    p_reason: parsed.data.reason,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as { invoice_id: string; version?: number } };
}

type InvoiceEmailSendMode = 'send' | 'retry' | 'resend';

type BeginInvoiceEmailSendResult = {
  id: string;
  idempotency_key: string;
  state: 'pending' | 'accepted' | 'uncertain' | 'failed' | 'disabled';
  attempt_count: number;
  send_sequence: number;
  key_expires_at: string;
  key_expired: boolean;
  reused: boolean;
};

/** Maps begin_invoice_email_send failures to a user message; falls back to the shared finance map. */
function invoiceEmailBeginError(error: { message?: string }): string {
  const code = error.message ?? '';
  if (code === 'INVOICE_NOT_ISSUED') return 'Only an issued invoice revision can be sent.';
  return financeError(error);
}

export async function sendInvoiceEmailAction(
  invoiceId: string,
  _prev: ActionResult<{ request_id: string; outcome: 'accepted' | 'failed' | 'uncertain' | 'disabled'; attempt: number; reused: boolean }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ request_id: string; outcome: 'accepted' | 'failed' | 'uncertain' | 'disabled'; attempt: number; reused: boolean }>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'documents.send') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to send invoice documents.');
  }
  const recipient = String(formData.get('recipient') ?? '').trim().toLowerCase();
  const revisionId = String(formData.get('revision_id') ?? '');
  const modeRaw = String(formData.get('mode') ?? 'send');
  const mode: InvoiceEmailSendMode = modeRaw === 'retry' || modeRaw === 'resend' ? modeRaw : 'send';
  if (!zUuid(invoiceId) || !zUuid(revisionId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return actionError('Enter a valid recipient email and invoice revision.');
  }
  const detail = await getInvoiceDetail(invoiceId);
  if (!detail.ok) return actionError('Invoice not found.');
  const revision = (detail.data.revisions as Array<Record<string, unknown>>).find((row) => row.id === revisionId);
  if (revision?.lifecycle !== 'issued') return actionError('Only an issued invoice revision can be sent.');
  const invoice = invoiceDocumentFromDetail(detail.data, revisionId);
  if (invoice.status !== 'issued' || invoice.revisionId !== revisionId) return actionError('Only an issued invoice revision can be sent.');

  const supabase = await createServerSupabaseClient();
  const { data: beginData, error: beginError } = await supabase.rpc('begin_invoice_email_send', {
    p_invoice_id: invoiceId, p_invoice_revision_id: revisionId, p_recipient: recipient, p_mode: mode,
  });
  if (beginError) return actionError(invoiceEmailBeginError(beginError));
  const request = beginData as BeginInvoiceEmailSendResult;

  // Defensive: the RPC never returns an already-accepted request for send/retry,
  // but never call the provider again if it somehow did.
  if (request.state === 'accepted') {
    return { ok: true, data: { request_id: request.id, outcome: 'accepted', attempt: request.attempt_count, reused: request.reused } };
  }

  let pdf: Buffer;
  try { pdf = await renderInvoicePdf(invoice); } catch { return actionError('The invoice PDF could not be generated.'); }

  const sendResult = await sendInvoiceEmail({ invoice, recipient, pdf, idempotencyKey: request.idempotency_key });
  const sender = (process.env.INVOICE_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL || '').trim() || 'disabled';

  const { error: finishError } = await supabase.rpc('finish_invoice_email_send', {
    p_send_request_id: request.id,
    p_outcome: sendResult.outcome === 'not_configured' ? 'failed' : sendResult.outcome,
    p_sender: sender,
    p_provider_message_id: sendResult.outcome === 'accepted' ? sendResult.providerMessageId : null,
    p_error_message: sendResult.outcome === 'accepted' ? null : sendResult.error,
  });

  if (finishError) {
    if (sendResult.outcome === 'accepted') {
      console.error('[email] finish_invoice_email_send failed after provider acceptance', { requestId: request.id, message: finishError.message });
      return actionError(
        `The provider accepted the invoice email, but delivery history could not be saved. Do not resend; retry recording later or ask an administrator to reconcile (request ${request.id}).`,
      );
    }
    console.error('[email] finish_invoice_email_send failed', { requestId: request.id, outcome: sendResult.outcome, message: finishError.message });
    return actionError('The outcome of this send could not be recorded. Please retry.');
  }

  revalidateInvoice(invoiceId);

  if (sendResult.outcome === 'accepted') {
    return { ok: true, data: { request_id: request.id, outcome: 'accepted', attempt: request.attempt_count, reused: request.reused } };
  }
  if (sendResult.outcome === 'not_configured') return actionError('Invoice email delivery is not configured.');
  if (sendResult.outcome === 'disabled') return actionError('Invoice email delivery is disabled.');
  if (sendResult.outcome === 'failed') return actionError('The email provider rejected this send. Fix the recipient/configuration and retry.');
  return actionError('The provider did not confirm this send. Use "Retry send" — it reuses the same idempotency key so the customer will not receive a duplicate.');
}

export async function createRefundAction(
  invoiceId: string,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'refunds.create') || !hasPermission(access, 'invoices.view') || !hasPermission(access, 'payments.view')) return actionError('You do not have permission to create credits or refunds.');
  let input: unknown;
  try { input = JSON.parse(String(formData.get('payload') ?? '{}')); } catch { return actionError('The credit/refund form could not be read.'); }
  const parsed = CreateCreditRefundSchema.safeParse(input);
  if (!parsed.success) return actionError('Check the credit lines, amount and reason.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('create_invoice_credit_refund', {
    p_request_id: parsed.data.request_id, p_invoice_id: invoiceId, p_expected_version: parsed.data.expected_version,
    p_input: { reason: parsed.data.reason, credit_lines: parsed.data.credit_lines, authorised_refund_amount: parsed.data.authorised_refund_amount, payments: parsed.data.payments },
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId); return { ok: true, data: data as InvoiceResult };
}

export async function confirmManualRefundAction(
  invoiceId: string,
  refundId: string,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'refunds.create') || !hasPermission(access, 'invoices.view') || !hasPermission(access, 'payments.view')) return actionError('You do not have permission to confirm refunds.');
  const parsed = ConfirmManualRefundSchema.safeParse({ request_id: formData.get('request_id'), expected_version: Number(formData.get('expected_version')), payout_method: formData.get('payout_method'), payout_reference: formData.get('payout_reference'), evidence: formData.get('evidence'), confirmed_at: null });
  if (!parsed.success) return actionError('Payout method, reference and evidence are required.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('confirm_manual_refund', { p_request_id: parsed.data.request_id, p_refund_id: refundId, p_expected_version: parsed.data.expected_version, p_evidence: { payout_method: parsed.data.payout_method, payout_reference: parsed.data.payout_reference, evidence: parsed.data.evidence } });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId); return { ok: true, data: data as InvoiceResult };
}

export async function retryRefundAction(
  invoiceId: string,
  refundId: string,
  _prev: ActionResult<InvoiceResult> | undefined,
  formData: FormData,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'refunds.create') || !hasPermission(access, 'invoices.view') || !hasPermission(access, 'payments.view')) return actionError('You do not have permission to retry refunds.');
  const parsed = RetryRefundSchema.safeParse({ request_id: formData.get('request_id'), expected_version: Number(formData.get('expected_version')) });
  if (!parsed.success) return actionError('The refund retry request is invalid.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('retry_invoice_refund', { p_request_id: parsed.data.request_id, p_refund_id: refundId, p_expected_version: parsed.data.expected_version });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId); return { ok: true, data: data as InvoiceResult };
}
