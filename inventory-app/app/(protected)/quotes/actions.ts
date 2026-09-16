'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { validateSaleLineLocations } from '@/lib/sales/sale-line-location';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { quoteDocumentFromDetail } from '@/lib/documents/quote-types';
import { renderQuotePdf } from '@/lib/documents/render-quote-pdf';
import { buildQuoteEmailPayload, quoteEmailPayloadSha256, sendQuoteEmail, storeQuoteEmailPayload } from '@/lib/email/quote-email';
const value = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const zUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const safeError = (error: { message: string; code?: string }) => { if (error.code === '40P01') return 'This quote conflicted with another concurrent change. Please retry.'; const code = error.message.match(/(?:^|: )([A-Z][A-Z0-9_]+)$/)?.[1] ?? ''; const known = new Set(['ACCESS_DENIED','QUOTE_VERSION_CONFLICT','INVALID_QUOTE_TRANSITION','QUOTE_NOT_EDITABLE','PRICE_PENDING','CUSTOMER_ARCHIVED','VEHICLE_CUSTOMER_MISMATCH','PRODUCT_INACTIVE','PO_REFERENCE_REQUIRED','IDEMPOTENCY_KEY_REUSED','QUOTE_NOT_SENDABLE','EMAIL_ALREADY_ACCEPTED','EMAIL_RECONCILIATION_REQUIRED','EMAIL_PAYLOAD_MISMATCH','EMAIL_SEND_IN_PROGRESS','EMAIL_RETRY_WINDOW_EXPIRED']); return known.has(code) ? code.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'The quote change could not be saved.'; };

export async function createQuoteAction(form: FormData) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.create')) redirect('/quotes');
  const client = await createServerSupabaseClient();
  const requestedLocation = value(form, 'location_id');
  const locationId = access.role === 'admin' ? requestedLocation : access.locationId;
  if (!locationId) throw new Error('Select a branch before creating a quote.');
  const requestId = value(form, 'request_id') || randomUUID();
  if (!zUuid(requestId)) throw new Error('The quote request is invalid. Please refresh and retry.');
  const parsedLines = JSON.parse(value(form, 'lines') || '[]') as unknown;
  if (!Array.isArray(parsedLines)) throw new Error('Check the quote lines and retry.');
  const lines = validateSaleLineLocations(parsedLines, locationId);
  const customerId = value(form, 'customer_id');
  const { data, error } = customerId
    ? await client.rpc('create_quote', { p_request_id: requestId, p_location_id: locationId, p_customer_id: customerId, p_customer_vehicle_id: value(form, 'customer_vehicle_id') || null, p_quote: { customer_reference: value(form, 'customer_reference'), internal_notes: value(form, 'internal_notes'), customer_notes: value(form, 'customer_notes') }, p_lines: lines })
    : await client.rpc('create_walk_in_quote', { p_request_id: requestId, p_location_id: locationId, p_contact: { name: value(form, 'walk_in_name'), phone: value(form, 'walk_in_phone') || null, email: value(form, 'walk_in_email') || null }, p_quote: { customer_reference: value(form, 'customer_reference'), customer_notes: value(form, 'customer_notes') }, p_lines: lines });
  if (error) throw new Error(safeError(error)); revalidatePath('/quotes'); redirect(`/quotes/${data.quote_id}`);
}

export async function updateQuoteDraftAction(quoteId: string, version: number, form: FormData) { const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.edit')) throw new Error('You do not have permission to edit quotes.'); const { error } = await (await createServerSupabaseClient()).rpc('update_quote_draft', { p_quote_id: quoteId, p_expected_version: version, p_quote: { customer_reference: value(form, 'customer_reference'), internal_notes: value(form, 'internal_notes'), customer_notes: value(form, 'customer_notes'), expiry_date: value(form, 'expiry_date') || null }, p_lines: JSON.parse(value(form, 'lines') || '[]') }); if (error) throw new Error(safeError(error)); revalidatePath(`/quotes/${quoteId}`); redirect(`/quotes/${quoteId}`); }
export async function transitionQuoteAction(quoteId: string, version: number, status: string) { const access = await getCurrentAccess(); const permission = status === 'accepted' ? 'quotes.accept' : 'quotes.edit'; if (!hasPermission(access, permission)) throw new Error('You do not have permission to change this quote.'); const { error } = await (await createServerSupabaseClient()).rpc('transition_quote', { p_quote_id: quoteId, p_expected_version: version, p_status: status }); if (error) throw new Error(safeError(error)); revalidatePath('/quotes'); revalidatePath(`/quotes/${quoteId}`); }

type QuoteEmailMode = 'send' | 'retry' | 'resend';
type QuoteEmailResult = { request_id: string; outcome: 'accepted' | 'failed' | 'uncertain' | 'disabled'; attempt: number; reused: boolean };
type QuoteEmailRequest = { id: string; idempotency_key: string; state: 'pending' | 'sending' | 'accepted' | 'uncertain' | 'failed' | 'disabled'; attempt_count: number; reused: boolean; provider_payload: Parameters<typeof sendQuoteEmail>[0]['preparedPayload'] };

export async function sendQuoteEmailAction(quoteId: string, _prev: { ok: boolean; data?: QuoteEmailResult; error?: string } | undefined, formData: FormData): Promise<{ ok: true; data: QuoteEmailResult } | { ok: false; error: string }> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.edit') || !hasPermission(access, 'quotes.view')) return { ok: false, error: 'You do not have permission to email quotes.' };
  const recipient = String(formData.get('recipient') ?? '').trim().toLowerCase();
  const modeRaw = String(formData.get('mode') ?? 'send');
  const mode: QuoteEmailMode = modeRaw === 'retry' || modeRaw === 'resend' ? modeRaw : 'send';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { ok: false, error: 'Enter a valid recipient email.' };
  const supabase = await createServerSupabaseClient();
  const { data: detail, error: detailError } = await supabase.rpc('quote_detail', { p_quote_id: quoteId });
  if (detailError || !detail) return { ok: false, error: 'Quote not found.' };
  const quote = quoteDocumentFromDetail(detail as Record<string, unknown>);
  if (!quote.total || quote.status === 'cancelled') return { ok: false, error: 'Only a priced, active quote can be emailed.' };
  let pdf: Buffer;
  try { pdf = await renderQuotePdf(quote); } catch { return { ok: false, error: 'The quote PDF could not be generated.' }; }
  const sender = (process.env.INVOICE_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL || '').trim();
  const payloadInput = { quote, recipient, pdf, from: sender, idempotencyKey: 'pending-durable-key' };
  const payloadSha256 = quoteEmailPayloadSha256(payloadInput);
  const providerPayload = storeQuoteEmailPayload(buildQuoteEmailPayload(payloadInput));
  const { data: prepared, error: prepareError } = await supabase.rpc('prepare_quote_email_send', { p_quote_id: quoteId, p_recipient: recipient, p_mode: mode, p_payload_sha256: payloadSha256, p_provider_payload: providerPayload, p_claim_provider: process.env.INVOICE_EMAIL_DELIVERY_ENABLED === 'true' && Boolean(sender) });
  if (prepareError) return { ok: false, error: safeError(prepareError) };
  const request = prepared as QuoteEmailRequest;
  const sendResult = await sendQuoteEmail({ recipient, idempotencyKey: request.idempotency_key, preparedPayload: request.provider_payload });
  const { error: finishError } = await supabase.rpc('finish_quote_email_send', { p_send_request_id: request.id, p_outcome: sendResult.outcome === 'not_configured' ? 'failed' : sendResult.outcome, p_sender: sender || 'disabled', p_provider_message_id: sendResult.outcome === 'accepted' ? sendResult.providerMessageId : null, p_error_message: sendResult.outcome === 'accepted' ? null : sendResult.error });
  if (finishError) return { ok: false, error: sendResult.outcome === 'accepted' ? `Provider accepted the email but delivery history could not be saved. Do not resend; request ${request.id} requires reconciliation.` : 'The email outcome could not be recorded. Please retry.' };
  revalidatePath(`/quotes/${quoteId}`); revalidatePath('/quotes');
  if (sendResult.outcome === 'accepted') return { ok: true, data: { request_id: request.id, outcome: 'accepted', attempt: request.attempt_count, reused: request.reused } };
  return { ok: false, error: sendResult.error };
}
export async function convertQuoteAction(quoteId: string, version: number) { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.create')) throw new Error('You do not have permission to create jobs.'); const { data, error } = await (await createServerSupabaseClient()).rpc('convert_quote_to_job', { p_quote_id: quoteId, p_expected_version: version, p_request_id: randomUUID() }); if (error) throw new Error(safeError(error)); revalidatePath('/quotes'); redirect(`/jobs/${data.job_id}`); }
