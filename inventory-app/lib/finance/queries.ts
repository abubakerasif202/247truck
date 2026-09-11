import 'server-only';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { FinanceSettingsDetail } from './types';

/**
 * Loads Admin finance settings through the `finance_settings_detail` RPC, which
 * repeats the hard Admin check server-side. Phase 4A exposes only non-secret
 * identity/branch configuration; provider activation flags are read-only and
 * always false.
 */
export async function getFinanceSettingsDetail(): Promise<
  { ok: true; data: FinanceSettingsDetail } | { ok: false; error: string }
> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('finance_settings_detail');

  if (error || !data) {
    return { ok: false, error: 'Could not load finance settings. Please refresh.' };
  }

  return { ok: true, data: data as FinanceSettingsDetail };
}

export type InvoiceListRow = {
  id: string;
  invoice_number: string;
  location_id: string;
  customer_id: string | null;
  customer_name: string | null;
  source_type: 'job' | 'pos' | 'manual';
  job_id: string | null;
  status: 'draft' | 'issued' | 'cancelled';
  issue_date: string | null;
  due_date: string | null;
  pricing_complete: boolean;
  total_incl_gst: string | null;
  gst_amount: string | null;
  revision_number: number;
  version: number;
  created_at: string;
  payment_state?: 'unpaid' | 'partial' | 'paid';
  is_overdue?: boolean;
  balance?: string;
  effective_paid?: string;
  display_status?: 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void';
};

export function buildInvoiceSummaryRpcArgs(filters: {
  status?: string | null;
  sourceType?: string | null;
  search?: string | null;
  sort?: string | null;
  direction?: string | null;
  page?: number;
  limit?: number;
  locationId?: string | null;
} = {}) {
  const allowedStatuses = ['draft', 'sent', 'issued', 'partial', 'paid', 'overdue', 'cancelled', 'void'];
  const allowedSources = ['job', 'pos', 'manual'];
  const allowedSorts = ['created_at', 'issue_date', 'due_date', 'invoice_number', 'customer_name', 'total'];
  const status = filters.status && allowedStatuses.includes(filters.status) ? filters.status : null;
  const source = filters.sourceType && allowedSources.includes(filters.sourceType) ? filters.sourceType : null;
  const search = (filters.search ?? '').trim().slice(0, 100);
  const sort = filters.sort && allowedSorts.includes(filters.sort) ? filters.sort : 'created_at';
  const direction = filters.direction === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  return {
    args: {
      p_location_id: filters.locationId ?? null, p_status: status, p_source_type: source, p_search: search || null, p_sort: sort,
      p_direction: direction, p_offset: (page - 1) * limit, p_limit: limit,
    },
    page,
    limit,
  };
}

/** Branch-scoped invoice list via the `invoice_summary_v2` RPC (RLS + guard repeat server-side). */
export async function listInvoices(filters: {
  status?: string | null;
  sourceType?: string | null;
  search?: string | null;
  sort?: string | null;
  direction?: string | null;
  page?: number;
  limit?: number;
  locationId?: string | null;
} = {}): Promise<
  { ok: true; rows: InvoiceListRow[]; total: number; page: number; limit: number }
  | { ok: false; error: string; page: number; limit: number }
> {
  const { args, page, limit } = buildInvoiceSummaryRpcArgs(filters);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('invoice_summary_v2', args);
  if (error || !data) {
    console.error('[finance] invoice_summary_v2 failed', { code: error?.code, message: error?.message });
    return { ok: false, error: 'Invoices could not be loaded. Please retry.', page, limit };
  }
  const result = data as { rows?: InvoiceListRow[]; total?: number };
  return {
    ok: true,
    rows: (result.rows ?? []).map((row) => ({ ...row, pricing_complete: row.total_incl_gst != null })),
    total: Number(result.total ?? 0),
    page,
    limit,
  };
}

export async function getInvoiceDetail(
  invoiceId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('invoice_detail', { p_invoice_id: invoiceId });
  if (error || !data) return { ok: false, error: 'not-found' };
  return { ok: true, data: data as Record<string, unknown> };
}

export async function getInvoiceCreditRefundHistory(invoiceId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await (await createServerSupabaseClient()).rpc('invoice_credit_refund_history', { p_invoice_id: invoiceId });
  return error || !data ? null : data as Record<string, unknown>;
}

export type EligibleJobRow = {
  id: string;
  job_number: string;
  location_id: string;
  customer_name: string | null;
  vehicle_registration: string | null;
  completed_at: string;
  total_incl_gst: string | null;
  pricing_complete: boolean;
};

export async function listEligibleJobs(
  query?: string,
): Promise<{ ok: true; data: EligibleJobRow[] } | { ok: false; error: string }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('eligible_jobs_for_invoice', {
    p_query: query ?? null,
    p_limit: 30,
  });
  if (error || !data) {
    console.error('[finance] eligible_jobs_for_invoice failed', { code: error?.code, message: error?.message });
    return { ok: false, error: 'Eligible jobs could not be loaded. Please retry.' };
  }
  return { ok: true, data: data as EligibleJobRow[] };
}

/** Finds the invoice linked to a job, if any (via the permission-checked `invoice_for_job` RPC). */
export async function findInvoiceForJob(
  jobId: string,
): Promise<{ id: string; invoice_number: string; status: string } | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('invoice_for_job', { p_job_id: jobId });
  if (error || !data) return null;
  return data as { id: string; invoice_number: string; status: string };
}

export type ReceivableRow = {
  invoice_id: string;
  invoice_number: string;
  location_code: string;
  customer_name: string;
  due_date: string | null;
  balance: number;
  credits: number;
  refund_due: number;
  payment_state: 'unpaid' | 'partial' | 'paid';
  is_overdue: boolean;
  aging_bucket: string;
  invoice_link_allowed: boolean;
};

export type ReceivablesCursor = { dueDate: string | null; invoiceId: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidCursor(dueDate: unknown, invoiceId: unknown): invoiceId is string {
  if (typeof invoiceId !== 'string' || !UUID_PATTERN.test(invoiceId)) return false;
  if (dueDate === null || dueDate === undefined) return true;
  return typeof dueDate === 'string' && DATE_PATTERN.test(dueDate);
}

export async function listReceivables(filters: {
  state?: string | null;
  search?: string | null;
  locationId?: string | null;
  cursorDueDate?: string | null;
  cursorInvoiceId?: string | null;
  limit?: number;
} = {}): Promise<
  { ok: true; data: ReceivableRow[]; hasMore: boolean; nextCursor: ReceivablesCursor | null }
  | { ok: false; error: string }
> {
  const search = (filters.search ?? '').trim();
  if (search.length > 100 || (filters.state && !['unpaid', 'partial', 'paid', 'overdue'].includes(filters.state))) {
    return { ok: false, error: 'Invalid receivables filter.' };
  }
  const cursorInvoiceId = filters.cursorInvoiceId ?? null;
  const cursorDueDate = filters.cursorDueDate ?? null;
  if (cursorInvoiceId !== null && !isValidCursor(cursorDueDate, cursorInvoiceId)) {
    return { ok: false, error: 'Invalid receivables cursor.' };
  }
  if (cursorInvoiceId === null && cursorDueDate !== null) {
    return { ok: false, error: 'Invalid receivables cursor.' };
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('customer_receivables_v2', {
    p_location_id: filters.locationId ?? null,
    p_customer_id: null,
    p_state: filters.state ?? null,
    p_search: search || null,
    p_due_from: null,
    p_due_to: null,
    p_cursor_due_date: cursorDueDate,
    p_cursor_invoice_id: cursorInvoiceId,
    p_limit: Math.min(Math.max(filters.limit ?? 50, 1), 100),
  });
  if (error || !data) {
    console.error('[finance] customer_receivables_v2 failed', { code: error?.code, message: error?.message });
    return { ok: false, error: 'Receivables could not be loaded. Please retry.' };
  }
  const result = data as { rows?: ReceivableRow[]; has_more?: boolean; next_cursor?: { due_date: string | null; invoice_id: string } | null };
  return {
    ok: true,
    data: result.rows ?? [],
    hasMore: Boolean(result.has_more),
    nextCursor: result.next_cursor ? { dueDate: result.next_cursor.due_date, invoiceId: result.next_cursor.invoice_id } : null,
  };
}
