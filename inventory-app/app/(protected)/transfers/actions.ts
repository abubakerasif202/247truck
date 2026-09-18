'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { friendlyTransferError } from '@/lib/transfers/errors';

export type TransferActionResult = { ok: boolean; error?: string; transferNumber?: string; transferId?: string };

function text(form: FormData, name: string) { return String(form.get(name) ?? '').trim(); }

export async function createTransferAction(_prev: TransferActionResult | undefined, form: FormData): Promise<TransferActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.transfer_request')) return { ok: false, error: 'You do not have permission to request transfers.' };
  const source = text(form, 'source_location_id'); const destination = text(form, 'destination_location_id');
  const products = form.getAll('product_id').map(value => String(value).trim());
  const quantities = form.getAll('requested_quantity').map(value => Number(value));
  if (!source || !destination || products.length === 0 || products.length !== quantities.length || products.some(product => !product) || quantities.some(quantity => !Number.isInteger(quantity) || quantity <= 0) || new Set(products).size !== products.length) return { ok: false, error: 'Choose both branches and add unique products with positive quantities.' };
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('create_transfer_request', {
    p_source_location_id: source, p_destination_location_id: destination,
    p_notes: text(form, 'notes') || null,
    p_lines: products.map((product_id, index) => ({ product_id, requested_quantity: quantities[index] })),
  });
  if (error) return { ok: false, error: friendlyTransferError(error.message) };
  const number = String(data);
  const summary = await supabase.rpc('transfer_summary', { p_status: 'draft' });
  const created = (summary.data as Array<{ id: string; transfer_number: string }> | null)?.find(row => row.transfer_number === number);
  if (!created) return { ok: false, error: 'Transfer was created but could not be submitted.' };
  const submitted = await supabase.rpc('submit_transfer_request', { p_transfer_id: created.id });
  if (submitted.error) return { ok: false, error: friendlyTransferError(submitted.error.message) };
  revalidatePath('/transfers');
  return { ok: true, transferNumber: number, transferId: created.id };
}

export async function createTransferFormAction(form: FormData): Promise<void> {
  const result = await createTransferAction(undefined, form);
  if (!result.ok) throw new Error(result.error);
}

function revalidateTransfer(id: string) {
  revalidatePath('/transfers');
  revalidatePath(`/transfers/${id}`);
}

async function transferLifecycleAction(
  id: string,
  permission: 'inventory.transfer_request' | 'admin',
  rpc: string,
  args: Record<string, unknown>,
): Promise<TransferActionResult> {
  const access = await getCurrentAccess();
  const allowed = permission === 'admin'
    ? access.role === 'admin'
    : hasPermission(access, permission);
  if (!allowed) {
    return { ok: false, error: 'You do not have permission to change this transfer.' };
  }

  const { error } = await (await createServerSupabaseClient()).rpc(rpc, args);
  if (error) return { ok: false, error: friendlyTransferError(error.message) };

  revalidateTransfer(id);
  return { ok: true, transferId: id };
}

export async function submitTransferStateAction(
  id: string,
  _prev: TransferActionResult | undefined,
  _form: FormData,
): Promise<TransferActionResult> {
  return transferLifecycleAction(id, 'inventory.transfer_request', 'submit_transfer_request', { p_transfer_id: id });
}

export async function approveTransferStateAction(
  id: string,
  _prev: TransferActionResult | undefined,
  _form: FormData,
): Promise<TransferActionResult> {
  return transferLifecycleAction(id, 'admin', 'approve_transfer', { p_transfer_id: id });
}

export async function dispatchTransferStateAction(
  id: string,
  _prev: TransferActionResult | undefined,
  _form: FormData,
): Promise<TransferActionResult> {
  return transferLifecycleAction(id, 'inventory.transfer_request', 'dispatch_transfer', {
    p_transfer_id: id,
    p_request_id: randomUUID(),
  });
}

export async function rejectTransferStateAction(
  id: string,
  _prev: TransferActionResult | undefined,
  form: FormData,
): Promise<TransferActionResult> {
  const reason = text(form, 'reason');
  if (!reason) return { ok: false, error: 'A rejection reason is required.' };
  return transferLifecycleAction(id, 'admin', 'reject_transfer', { p_transfer_id: id, p_reason: reason });
}

export async function cancelTransferStateAction(
  id: string,
  _prev: TransferActionResult | undefined,
  form: FormData,
): Promise<TransferActionResult> {
  return transferLifecycleAction(id, 'admin', 'cancel_transfer', {
    p_transfer_id: id,
    p_reason: text(form, 'reason') || null,
  });
}

export async function resolveTransferStateAction(
  id: string,
  _prev: TransferActionResult | undefined,
  form: FormData,
): Promise<TransferActionResult> {
  const notes = text(form, 'reason');
  if (!notes) return { ok: false, error: 'Resolution notes are required.' };
  return transferLifecycleAction(id, 'admin', 'resolve_transfer_discrepancy', {
    p_transfer_id: id,
    p_notes: notes,
  });
}

export async function receiveTransferAction(id: string, _prev: TransferActionResult | undefined, form: FormData): Promise<TransferActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.transfer_request')) return { ok: false, error: 'You do not have permission to receive transfers.' };
  const detail = await (await import('@/lib/transfers/queries')).getTransferDetail(await createServerSupabaseClient(), id);
  if (access.role === 'manager' && access.locationId !== detail.destination_location_id) return { ok: false, error: 'You can only receive transfers into your branch.' };
  const receipts = detail.lines.map(line => ({ product_id: line.product_id, received_quantity: Number(form.get(`received_${line.product_id}`) ?? 0) }));
  const { error } = await (await createServerSupabaseClient()).rpc('receive_transfer', { p_transfer_id: id, p_request_id: randomUUID(), p_receipts: receipts });
  if (error) return { ok: false, error: friendlyTransferError(error.message) };
  revalidatePath('/transfers'); revalidatePath(`/transfers/${id}`); return { ok: true };
}

export async function receiveTransferFormAction(id: string, form: FormData): Promise<void> {
  const result = await receiveTransferAction(id, undefined, form);
  if (!result.ok) throw new Error(result.error);
}
