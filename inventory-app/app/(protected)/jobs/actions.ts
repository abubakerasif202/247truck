'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { validateSaleLineLocations } from '@/lib/sales/sale-line-location';
import { createServerSupabaseClient } from '@/lib/supabase/server';
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const optionalField = (form: FormData, key: string, max: number) => { const text = value(form, key); if (text.length > max) throw new Error(`${key === 'extra_description' ? 'Extra Description' : 'Notes'} must be ${max} characters or fewer.`); return text || null; };
const zUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const safeError = (error: { message: string; code?: string }) => { if (error.code === '40P01') return 'This job conflicted with another concurrent checkout. Please retry.'; const code = error.message.match(/(?:^|: )([A-Z][A-Z0-9_]+)$/)?.[1] ?? ''; const known = new Set(['ACCESS_DENIED','JOB_VERSION_CONFLICT','INVALID_JOB_TRANSITION','JOB_NOT_EDITABLE','JOB_ALREADY_COMPLETED','PRICE_PENDING','PRICE_OVERRIDE_NOT_AUTHORIZED','CUSTOMER_ARCHIVED','VEHICLE_ARCHIVED','VEHICLE_CUSTOMER_MISMATCH','PRODUCT_INACTIVE','INSUFFICIENT_STOCK','USED_TYRE_NOT_AVAILABLE','USED_TYRE_QUANTITY_MUST_BE_ONE','USED_TYRE_PRODUCT_OR_LOCATION_MISMATCH','RESERVATION_INCONSISTENT','IDEMPOTENCY_KEY_REUSED']); return known.has(code) ? code.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'The workshop job change could not be saved.'; };
function withValidatedTorque(lines: unknown[]): unknown[] {
  return lines.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Check the job lines and retry.');
    const line = value as Record<string, unknown>;
    const raw = line.torque_nm == null ? '' : String(line.torque_nm).trim();
    if (!raw) return { ...line, torque_nm: null };
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) <= 0) throw new Error('Torque must be a positive number of Nm with up to two decimal places.');
    return { ...line, torque_nm: raw };
  });
}
export async function createJobAction(form: FormData) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.create')) redirect('/jobs');
  const requestedLocation = value(form, 'location_id');
  const locationId = access.role === 'admin' ? requestedLocation : access.locationId;
  if (!locationId) throw new Error('Select a branch before creating a job.');
  const requestId = value(form, 'request_id') || randomUUID();
  if (!zUuid(requestId)) throw new Error('The job request is invalid. Please refresh and retry.');
  const parsedLines = JSON.parse(value(form, 'lines') || '[]') as unknown;
  if (!Array.isArray(parsedLines)) throw new Error('Check the job lines and retry.');
  const lines = withValidatedTorque(validateSaleLineLocations(parsedLines, locationId));
  const { data, error } = await (await createServerSupabaseClient()).rpc('create_job', { p_request_id: requestId, p_location_id: locationId, p_customer_id: value(form, 'customer_id') || null, p_customer_vehicle_id: value(form, 'customer_vehicle_id') || null, p_job: { source_type: value(form, 'customer_id') ? (value(form, 'source_type') || 'direct') : 'pos', walk_in_label: value(form, 'walk_in_label') || null, customer_reference: value(form, 'customer_reference') || null, technician_notes: optionalField(form, 'technician_notes', 5000), extra_description: optionalField(form, 'extra_description', 5000), customer_notes: optionalField(form, 'customer_notes', 2000) }, p_lines: lines });
  if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath('/pos'); redirect(`/jobs/${data.job_id}`);
}

export async function transitionJobAction(jobId: string, version: number, status: string) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.edit')) throw new Error('You do not have permission to edit jobs.'); const { error } = await (await createServerSupabaseClient()).rpc('transition_job', { p_job_id: jobId, p_expected_version: version, p_status: status }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath(`/jobs/${jobId}`); }
export async function cancelJobAction(jobId: string, version: number) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.edit')) throw new Error('You do not have permission to edit jobs.'); const { error } = await (await createServerSupabaseClient()).rpc('cancel_job', { p_job_id: jobId, p_expected_version: version }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath(`/jobs/${jobId}`); }
export async function completeJobAction(jobId: string, version: number) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.complete')) throw new Error('You do not have permission to complete jobs.'); const { error } = await (await createServerSupabaseClient()).rpc('complete_job', { p_job_id: jobId, p_expected_version: version, p_request_id: randomUUID() }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); revalidatePath(`/jobs/${jobId}`); }
export async function updateJobAction(jobId: string, version: number, form: FormData) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.edit')) throw new Error('You do not have permission to edit jobs.'); const rawLines = JSON.parse(value(form, 'lines') || '[]') as unknown; if (!Array.isArray(rawLines)) throw new Error('Check the job lines and retry.'); const lines = withValidatedTorque(rawLines); const { data, error } = await (await createServerSupabaseClient()).rpc('update_job', { p_job_id: jobId, p_expected_version: version, p_job: { customer_reference: value(form, 'customer_reference') || null, technician_notes: optionalField(form, 'technician_notes', 5000), extra_description: optionalField(form, 'extra_description', 5000), customer_notes: optionalField(form, 'customer_notes', 2000) }, p_lines: lines }); if (error) throw new Error(safeError(error)); revalidatePath('/jobs'); redirect(`/jobs/${data.job_id}`); }
