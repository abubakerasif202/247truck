'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { mapPurchasingRpcError } from '@/lib/purchasing/errors';
import { parsePurchaseOrderDraft } from '@/lib/purchasing/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type PurchaseOrderActionResult = {
  ok: boolean;
  error?: string;
  purchaseOrderId?: string;
};

function validationError(error: unknown, fallback: string): PurchaseOrderActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

function lineArgs(input: ReturnType<typeof parsePurchaseOrderDraft>) {
  return input.lines.map((line) => ({
    product_id: line.productId,
    ordered_quantity: line.orderedQuantity,
    unit_cost: line.unitCost,
    notes: line.notes,
  }));
}

function revalidatePurchaseOrder(purchaseOrderId?: string) {
  revalidatePath('/purchasing/purchase-orders');
  if (purchaseOrderId) {
    revalidatePath(`/purchasing/purchase-orders/${purchaseOrderId}`);
  }
}

export async function createPurchaseOrderAction(
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.create_po')) {
    return { ok: false, error: 'You do not have permission to create purchase orders.' };
  }

  let input: ReturnType<typeof parsePurchaseOrderDraft>;
  try {
    input = parsePurchaseOrderDraft(formData);
  } catch (error) {
    return validationError(error, 'Check the purchase order details.');
  }

  if (access.role === 'manager' && input.locationId !== access.locationId) {
    return { ok: false, error: 'You can only create purchase orders for your assigned location.' };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('create_purchase_order_draft', {
    p_location_id: input.locationId,
    p_supplier_id: input.supplierId,
    p_supplier_reference: input.supplierReference,
    p_notes: input.notes,
    p_lines: lineArgs(input),
  });

  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not create the purchase order.'),
    };
  }

  const purchaseOrderId = data as string;
  revalidatePurchaseOrder(purchaseOrderId);
  return { ok: true, purchaseOrderId };
}

export async function updatePurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.create_po')) {
    return { ok: false, error: 'You do not have permission to edit purchase orders.' };
  }

  let input: ReturnType<typeof parsePurchaseOrderDraft>;
  try {
    input = parsePurchaseOrderDraft(formData);
  } catch (error) {
    return validationError(error, 'Check the purchase order details.');
  }

  if (access.role === 'manager' && input.locationId !== access.locationId) {
    return { ok: false, error: 'You can only edit purchase orders for your assigned location.' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('update_purchase_order_draft', {
    p_purchase_order_id: purchaseOrderId,
    p_supplier_id: input.supplierId,
    p_supplier_reference: input.supplierReference,
    p_notes: input.notes,
    p_lines: lineArgs(input),
  });

  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not save the purchase order.'),
    };
  }

  revalidatePurchaseOrder(purchaseOrderId);
  return { ok: true, purchaseOrderId };
}

async function statusAction(
  purchaseOrderId: string,
  rpcName:
    | 'submit_purchase_order'
    | 'approve_purchase_order'
    | 'mark_purchase_order_sent',
  permission: 'purchasing.submit_po' | 'admin',
  fallback: string,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  const allowed =
    permission === 'admin'
      ? access.role === 'admin'
      : hasPermission(access, permission);
  if (!allowed) {
    return { ok: false, error: 'You do not have permission to perform this action.' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc(rpcName, {
    p_purchase_order_id: purchaseOrderId,
  });
  if (error) {
    return { ok: false, error: mapPurchasingRpcError(error, fallback) };
  }

  revalidatePurchaseOrder(purchaseOrderId);
  return { ok: true, purchaseOrderId };
}

export async function submitPurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  _formData: FormData,
): Promise<PurchaseOrderActionResult> {
  return statusAction(
    purchaseOrderId,
    'submit_purchase_order',
    'purchasing.submit_po',
    'Could not submit the purchase order.',
  );
}

export async function approvePurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  _formData: FormData,
): Promise<PurchaseOrderActionResult> {
  return statusAction(
    purchaseOrderId,
    'approve_purchase_order',
    'admin',
    'Could not approve the purchase order.',
  );
}

export async function markPurchaseOrderSentAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  _formData: FormData,
): Promise<PurchaseOrderActionResult> {
  return statusAction(
    purchaseOrderId,
    'mark_purchase_order_sent',
    'admin',
    'Could not mark the purchase order as sent.',
  );
}

function reason(formData: FormData, field: string, requiredMessage: string): string {
  const value = formData.get(field);
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) throw new Error(requiredMessage);
  if (parsed.length > 2000) throw new Error('Reason is too long.');
  return parsed;
}

export async function rejectPurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can reject purchase orders.' };
  }

  let rejectionReason: string;
  try {
    rejectionReason = reason(formData, 'reason', 'A rejection reason is required.');
  } catch (error) {
    return validationError(error, 'Check the rejection reason.');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('reject_purchase_order', {
    p_purchase_order_id: purchaseOrderId,
    p_reason: rejectionReason,
  });
  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not reject the purchase order.'),
    };
  }

  revalidatePurchaseOrder(purchaseOrderId);
  return { ok: true, purchaseOrderId };
}

export async function cancelPurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can cancel purchase orders.' };
  }

  let cancellationReason: string;
  try {
    cancellationReason = reason(formData, 'reason', 'A cancellation reason is required.');
  } catch (error) {
    return validationError(error, 'Check the cancellation reason.');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('cancel_purchase_order', {
    p_purchase_order_id: purchaseOrderId,
    p_reason: cancellationReason,
  });
  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not cancel the purchase order.'),
    };
  }

  revalidatePurchaseOrder(purchaseOrderId);
  return { ok: true, purchaseOrderId };
}
