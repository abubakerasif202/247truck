'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type TransferActionResult = { ok: boolean; error?: string; transferNumber?: string };

function text(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }

export async function createTransferAction(_prev: TransferActionResult | undefined, form: FormData): Promise<TransferActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.transfer_request')) return { ok: false, error: 'You do not have permission to request transfers.' };
  const source = text(form, 'source_location_id'); const destination = text(form, 'destination_location_id');
  const product = text(form, 'product_id'); const quantity = Number(text(form, 'requested_quantity'));
  if (!source || !destination || !product || !Number.isInteger(quantity) || quantity <= 0) return { ok: false, error: 'Choose both branches, a product, and a positive quantity.' };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('create_transfer_request', {
    p_source_location_id: source, p_destination_location_id: destination,
    p_notes: text(form, 'notes') || null,
    p_lines: [{ product_id: product, requested_quantity: quantity }],
  });
  if (error) return { ok: false, error: error.message.replace(/^.*?: /, '') };
  const number = String(data);
  const summary = await supabase.rpc('transfer_summary', { p_status: 'draft' });
  const created = (summary.data as Array<{ id: string; transfer_number: string }> | null)?.find(row => row.transfer_number === number);
  if (!created) return { ok: false, error: 'Transfer was created but could not be submitted.' };
  const submitted = await supabase.rpc('submit_transfer_request', { p_transfer_id: created.id });
  if (submitted.error) return { ok: false, error: submitted.error.message };
  revalidatePath('/transfers');
  return { ok: true, transferNumber: number };
}

export async function createTransferFormAction(form: FormData): Promise<void> {
  await createTransferAction(undefined, form);
}

export async function submitTransferAction(id: string) { const s = await createServerSupabaseClient(); await s.rpc('submit_transfer_request', { p_transfer_id: id }); revalidatePath('/transfers'); revalidatePath(`/transfers/${id}`); }
export async function approveTransferAction(id: string) { const s = await createServerSupabaseClient(); await s.rpc('approve_transfer', { p_transfer_id: id }); revalidatePath('/transfers'); revalidatePath(`/transfers/${id}`); }
export async function dispatchTransferAction(id: string) { const s = await createServerSupabaseClient(); await s.rpc('dispatch_transfer', { p_transfer_id: id, p_request_id: randomUUID() }); revalidatePath('/transfers'); revalidatePath(`/transfers/${id}`); }

export async function receiveTransferAction(id: string, _prev: TransferActionResult | undefined, form: FormData): Promise<TransferActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') return { ok: false, error: 'Only an Admin can receive stock.' };
  const detail = await (await import('@/lib/transfers/queries')).getTransferDetail(await createServerSupabaseClient(), id);
  const receipts = detail.lines.map(line => ({ product_id: line.product_id, received_quantity: Number(form.get(`received_${line.product_id}`) ?? 0) }));
  const { error } = await (await createServerSupabaseClient()).rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: receipts });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/transfers'); revalidatePath(`/transfers/${id}`); return { ok: true };
}

export async function receiveTransferFormAction(id: string, form: FormData): Promise<void> {
  await receiveTransferAction(id, undefined, form);
}
