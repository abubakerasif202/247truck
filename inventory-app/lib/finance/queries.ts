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
};

/** Branch-scoped invoice list via the `invoice_summary` RPC (RLS + guard repeat server-side). */
export async function listInvoices(filters: {
  status?: string | null;
  sourceType?: string | null;
  limit?: number;
} = {}): Promise<InvoiceListRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('invoice_summary', {
    p_status: filters.status ?? null,
    p_source_type: filters.sourceType ?? null,
    p_limit: Math.min(Math.max(filters.limit ?? 50, 1), 100),
  });
  if (error || !data) return [];
  return data as InvoiceListRow[];
}

export async function getInvoiceDetail(
  invoiceId: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('invoice_detail', { p_invoice_id: invoiceId });
  if (error || !data) return { ok: false, error: 'not-found' };
  return { ok: true, data: data as Record<string, unknown> };
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

export async function listEligibleJobs(query?: string): Promise<EligibleJobRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('eligible_jobs_for_invoice', {
    p_query: query ?? null,
    p_limit: 30,
  });
  if (error || !data) return [];
  return data as EligibleJobRow[];
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
