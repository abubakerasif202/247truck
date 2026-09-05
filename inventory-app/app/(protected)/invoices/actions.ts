'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';

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
import type { InvoiceResult } from '@/lib/finance/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
  return { ok: true, data: data as InvoiceResult };
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
  return { ok: true, data: data as InvoiceResult };
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
  const { data, error } = await supabase.rpc('create_manual_invoice', {
    p_request_id: randomUUID(),
    p_location_id: locationId,
    p_input: {
      customer_id: parsed.data.customer_id ?? null,
      customer_vehicle_id: parsed.data.customer_vehicle_id ?? null,
      payment_terms: parsed.data.payment_terms ?? null,
      customer_reference: parsed.data.customer_reference ?? null,
      customer_notes: parsed.data.customer_notes ?? null,
      lines: parsed.data.lines,
    },
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(data.invoice_id);
  return { ok: true, data: data as InvoiceResult };
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
  const { data, error } = await supabase.rpc('update_invoice_draft', {
    p_request_id: randomUUID(),
    p_invoice_id: invoiceId,
    p_expected_version: parsed.data.expected_version,
    p_input: {
      payment_terms: parsed.data.payment_terms ?? null,
      customer_reference: parsed.data.customer_reference ?? null,
      customer_notes: parsed.data.customer_notes ?? null,
      lines: parsed.data.lines,
    },
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as InvoiceResult };
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
  const { data, error } = await supabase.rpc('revise_unpaid_invoice', {
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
  return { ok: true, data: data as InvoiceResult };
}

export async function issueInvoiceAction(
  invoiceId: string,
  expectedVersion: number,
): Promise<ActionResult<InvoiceResult>> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.issue') || !hasPermission(access, 'invoices.view')) {
    return actionError('You do not have permission to issue invoices.');
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('issue_invoice', {
    p_request_id: randomUUID(),
    p_invoice_id: invoiceId,
    p_expected_version: expectedVersion,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as InvoiceResult };
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
  if (!reason) return actionError('A reason is required to cancel an invoice.');
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('cancel_invoice', {
    p_request_id: randomUUID(),
    p_invoice_id: invoiceId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) return actionError(financeError(error));
  revalidateInvoice(invoiceId);
  return { ok: true, data: data as InvoiceResult };
}
