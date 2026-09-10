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
import { RecordPaymentSchema, ReversePaymentSchema } from '@/lib/finance/validation';
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

export async function sendInvoiceEmailAction(
  invoiceId: string,
  _prev: ActionResult<{ delivery_id?: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ delivery_id?: string }>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'documents.send') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to send invoice documents.');
  }
  const recipient = String(formData.get('recipient') ?? '').trim().toLowerCase();
  const revisionId = String(formData.get('revision_id') ?? '');
  if (!zUuid(invoiceId) || !zUuid(revisionId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return actionError('Enter a valid recipient email and invoice revision.');
  }
  const detail = await getInvoiceDetail(invoiceId);
  if (!detail.ok) return actionError('Invoice not found.');
  const invoice = invoiceDocumentFromDetail(detail.data, revisionId);
  if (invoice.status !== 'issued' || invoice.revisionId !== revisionId) return actionError('Only an issued invoice revision can be sent.');
  const sender = (process.env.INVOICE_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL || '').trim();
  const supabase = await createServerSupabaseClient();
  const save = (state: 'sent' | 'failed' | 'disabled', message: string | null, providerMessageId: string | null) =>
    supabase.rpc('record_invoice_email_delivery', {
      p_invoice_id: invoice.invoiceId, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient,
      p_sender: sender || 'disabled', p_provider: state === 'disabled' ? 'disabled' : 'resend',
      p_delivery_state: state, p_provider_message_id: providerMessageId, p_error_message: message, p_retry_of: null,
    });
  let pdf: Buffer;
  try { pdf = await renderInvoicePdf(invoice); } catch { return actionError('The invoice PDF could not be generated.'); }
  const result = await sendInvoiceEmail({ invoice, recipient, pdf, idempotencyKey: `invoice/${invoice.invoiceId}/${invoice.revisionId}/${randomUUID()}`, recorder: {
    accepted: async (record) => { await save('sent', null, record.providerMessageId); },
    failed: async (record) => { await save('failed', record.error, null); },
    disabled: async (record) => { await save('disabled', record.error, null); },
  } });
  if (!result.ok) return actionError(result.error);
  revalidateInvoice(invoiceId);
  return { ok: true, data: {} };
}
