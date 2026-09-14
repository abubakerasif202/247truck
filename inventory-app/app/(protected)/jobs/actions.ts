'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const zUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const safeError = (error: { message: string; code?: string }) => { if (error.code === '40P01') return 'This job conflicted with another concurrent checkout. Please retry.'; const code = error.message.match(/(?:^|: )([A-Z][A-Z0-9_]+)$/)?.[1] ?? ''; const known = new Set(['ACCESS_DENIED','JOB_VERSION_CONFLICT','INVALID_JOB_TRANSITION','JOB_NOT_EDITABLE','JOB_ALREADY_COMPLETED','PRICE_PENDING','CUSTOMER_ARCHIVED','VEHICLE_ARCHIVED','VEHICLE_CUSTOMER_MISMATCH','PRODUCT_INACTIVE','INSUFFICIENT_STOCK','USED_TYRE_NOT_AVAILABLE','USED_TYRE_QUANTITY_MUST_BE_ONE','USED_TYRE_PRODUCT_OR_LOCATION_MISMATCH','RESERVATION_INCONSISTENT','IDEMPOTENCY_KEY_REUSED']); return known.has(code) ? code.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'The workshop job change could not be saved.'; };
export async function createJobAction(form: FormData) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.create')) redirect('/jobs');
  const requestedLocation = value(form, 'location_id');
  const locationId = access.role === 'admin' ? requestedLocation : access.locationId;
  if (!locationId) throw new Error('Select a branch before creating a job.');
  const requestId = value(form, 'request_id') || randomUUID();
  if (!zUuid(requestId)) throw new Error('The job request is invalid. Please refresh and retry.');
  const { data, error } = await (await createServerSupabaseClient()).rpc('create_job', { p_request_id: requestId, p_location_id: locationId, p_customer_id: value(form, 'customer_id') || null, p_customer_vehicle_id: value(form, 'customer_vehicle_id') || null, p_job: { source_type: value(form, 'customer_id') ? (value(form, 'source_type') || 'direct') : 'pos', walk_in_label: value(form, 'walk_in_label') || null, customer_reference: value(form, 'customer_reference'), technician_notes: value(form, 'technician_notes'), customer_notes: value(form, 'customer_notes') }, p_lines: JSON.parse(value(form, 'lines') || '[]') });
  if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath('/pos'); redirect(`/jobs/${data.job_id}`);
}

export async function transitionJobAction(jobId: string, version: number, status: string) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.edit')) throw new Error('You do not have permission to edit jobs.'); const { error } = await (await createServerSupabaseClient()).rpc('transition_job', { p_job_id: jobId, p_expected_version: version, p_status: status }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath(`/jobs/${jobId}`); }
export async function cancelJobAction(jobId: string, version: number) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.edit')) throw new Error('You do not have permission to edit jobs.'); const { error } = await (await createServerSupabaseClient()).rpc('cancel_job', { p_job_id: jobId, p_expected_version: version }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath(`/jobs/${jobId}`); }
export async function completeJobAction(jobId: string, version: number) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.complete')) throw new Error('You do not have permission to complete jobs.'); const { error } = await (await createServerSupabaseClient()).rpc('complete_job', { p_job_id: jobId, p_expected_version: version, p_request_id: randomUUID() }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath(`/jobs/${jobId}`); }
export async function updateJobAction(jobId: string, version: number, form: FormData) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.edit')) throw new Error('You do not have permission to edit jobs.'); const { data, error } = await (await createServerSupabaseClient()).rpc('update_job', { p_job_id: jobId, p_expected_version: version, p_job: { customer_reference: value(form, 'customer_reference'), technician_notes: value(form, 'technician_notes'), customer_notes: value(form, 'customer_notes') }, p_lines: JSON.parse(value(form, 'lines') || '[]') }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); redirect(`/jobs/${data.job_id}`); }
