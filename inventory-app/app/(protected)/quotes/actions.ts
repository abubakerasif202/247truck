'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const safeError = (message: string) => { const code = message.match(/(?:^|: )([A-Z][A-Z0-9_]+)$/)?.[1] ?? ''; const known = new Set(['ACCESS_DENIED','QUOTE_VERSION_CONFLICT','INVALID_QUOTE_TRANSITION','QUOTE_NOT_EDITABLE','PRICE_PENDING','CUSTOMER_ARCHIVED','VEHICLE_CUSTOMER_MISMATCH','PRODUCT_INACTIVE','PO_REFERENCE_REQUIRED','IDEMPOTENCY_KEY_REUSED']); return known.has(code) ? code.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'The quote change could not be saved.'; };

export async function createQuoteAction(form: FormData) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.create')) redirect('/quotes');
  const client = await createServerSupabaseClient();
  const locationId = value(form, 'location_id') || access.locationId;
  if (!locationId) throw new Error('Select a branch before creating a quote.');
  const { data, error } = await client.rpc('create_quote', { p_request_id: value(form, 'request_id') || randomUUID(), p_location_id: locationId, p_customer_id: value(form, 'customer_id'), p_customer_vehicle_id: value(form, 'customer_vehicle_id') || null, p_quote: { customer_reference: value(form, 'customer_reference'), internal_notes: value(form, 'internal_notes'), customer_notes: value(form, 'customer_notes') }, p_lines: JSON.parse(value(form, 'lines') || '[]') });
  if (error) throw new Error(safeError(error.message)); revalidatePath('/quotes'); redirect(`/quotes/${data.quote_id}`);
}

export async function updateQuoteDraftAction(quoteId: string, version: number, form: FormData) { const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.edit')) throw new Error('You do not have permission to edit quotes.'); const { data, error } = await (await createServerSupabaseClient()).rpc('update_quote_draft', { p_quote_id: quoteId, p_expected_version: version, p_quote: { customer_reference: value(form, 'customer_reference'), internal_notes: value(form, 'internal_notes'), customer_notes: value(form, 'customer_notes'), expiry_date: value(form, 'expiry_date') || null }, p_lines: JSON.parse(value(form, 'lines') || '[]') }); if (error) throw new Error(safeError(error.message)); revalidatePath(`/quotes/${quoteId}`); redirect(`/quotes/${quoteId}`); }
export async function transitionQuoteAction(quoteId: string, version: number, status: string) { const access = await getCurrentAccess(); const permission = status === 'accepted' ? 'quotes.accept' : 'quotes.edit'; if (!hasPermission(access, permission)) throw new Error('You do not have permission to change this quote.'); const { error } = await (await createServerSupabaseClient()).rpc('transition_quote', { p_quote_id: quoteId, p_expected_version: version, p_status: status }); if (error) throw new Error(safeError(error.message)); revalidatePath('/quotes'); revalidatePath(`/quotes/${quoteId}`); }
export async function convertQuoteAction(quoteId: string, version: number) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.create')) throw new Error('You do not have permission to create jobs.'); const { data, error } = await (await createServerSupabaseClient()).rpc('convert_quote_to_job', { p_quote_id: quoteId, p_expected_version: version, p_request_id: randomUUID() }); if (error) throw new Error(safeError(error.message)); revalidatePath('/quotes'); redirect(`/jobs/${data.job_id}`); }
