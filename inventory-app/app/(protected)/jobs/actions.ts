'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
export async function createJobAction(form: FormData) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.create')) redirect('/jobs');
  const locationId = value(form, 'location_id') || access.locationId; if (!locationId) throw new Error('Select a branch before creating a job.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('create_job', { p_request_id: value(form, 'request_id') || randomUUID(), p_location_id: locationId, p_customer_id: value(form, 'customer_id'), p_customer_vehicle_id: value(form, 'customer_vehicle_id') || null, p_job: { source_type: value(form, 'source_type') || 'direct', customer_reference: value(form, 'customer_reference'), technician_notes: value(form, 'technician_notes'), customer_notes: value(form, 'customer_notes') }, p_lines: JSON.parse(value(form, 'lines') || '[]') });
  if (error) throw new Error(error.message); revalidatePath('/jobs'); revalidatePath('/pos'); redirect(`/jobs/${data.job_id}`);
}

