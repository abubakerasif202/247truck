'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function finalisePosSaleAction(form: FormData): Promise<void> {
  const access = await getCurrentAccess();
  let tenders: unknown;
  let lines: unknown;
  try {
    tenders = JSON.parse(text(form, 'tenders') || '[]') as unknown;
    lines = JSON.parse(text(form, 'lines') || '[]') as unknown;
  } catch {
    throw new Error('Check the POS lines and tender.');
  }
  if (!hasPermission(access, 'pos.use') || !hasPermission(access, 'jobs.view') || !hasPermission(access, 'jobs.create') || !hasPermission(access, 'jobs.edit') || !hasPermission(access, 'jobs.complete') || !hasPermission(access, 'invoices.view') || !hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.issue')) {
    throw new Error('You do not have permission to finalise POS sales.');
  }
  if (!Array.isArray(tenders) || !Array.isArray(lines)) throw new Error('Check the POS lines and tender.');
  if (tenders.length > 0 && (!hasPermission(access, 'payments.view') || !hasPermission(access, 'payments.record'))) {
    throw new Error('You do not have permission to record payment tenders.');
  }
  const requestedLocation = text(form, 'location_id');
  const locationId = access.role === 'admin' ? requestedLocation : access.locationId;
  if (!locationId) throw new Error('Select a branch before finalising the sale.');
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc('finalise_pos_sale', {
    p_request_id: text(form, 'request_id') || randomUUID(),
    p_location_id: locationId,
    p_customer_id: text(form, 'customer_id') || null,
    p_customer_vehicle_id: text(form, 'customer_vehicle_id') || null,
    p_job_id: null,
    p_expected_job_version: null,
    p_job: { source_type: 'pos', walk_in_label: text(form, 'customer_id') ? null : 'Walk-in customer' },
    p_lines: lines,
    p_tenders: tenders,
  });
  if (error) throw new Error('The POS sale could not be finalised. Please review the sale and retry.');
  revalidatePath('/pos');
  revalidatePath('/jobs');
  revalidatePath('/invoices');
  revalidatePath('/receivables');
  redirect(`/invoices/${String(data.invoice_id)}`);
}
