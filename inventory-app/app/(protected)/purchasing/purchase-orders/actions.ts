'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { mapPurchasingRpcError } from '@/lib/purchasing/errors';
import { getPurchaseOrderDetail } from '@/lib/purchasing/queries';
import {
  parsePurchaseOrderDraft,
  parseReceiptForm,
  parseReorderSelection,
  parseReorderSettings,
} from '@/lib/purchasing/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type PurchaseOrderActionResult = {
  ok: boolean;
  error?: string;
  purchaseOrderId?: string;
  purchaseOrderIds?: string[];
};

export async function setInventoryReorderSettingsAction(
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.create_po')) {
    return { ok: false, error: 'You do not have permission to change reorder settings.' };
  }

  let input: ReturnType<typeof parseReorderSettings>;
  try {
    input = parseReorderSettings(formData);
  } catch (error) {
    return validationError(error, 'Check the reorder settings.');
  }
  if (access.role === 'manager' && input.locationId !== access.locationId) {
    return { ok: false, error: 'You can only change settings for your assigned location.' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('set_inventory_reorder_settings', {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_minimum_stock: input.minimumStock,
    p_reorder_quantity: input.reorderQuantity,
    p_preferred_supplier_id: input.preferredSupplierId,
  });
  if (error) {
    return { ok: false, error: mapPurchasingRpcError(error, 'Could not save reorder settings.') };
  }
  revalidatePath('/purchasing/reorder');
  return { ok: true };
}

export async function createDraftPurchaseOrdersFromReorderAction(
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.create_po')) {
    return { ok: false, error: 'You do not have permission to create purchase orders.' };
  }

  let input: ReturnType<typeof parseReorderSelection>;
  try {
    input = parseReorderSelection(formData);
  } catch (error) {
    return validationError(error, 'Select at least one product.');
  }
  if (access.role === 'manager' && input.locationId !== access.locationId) {
    return { ok: false, error: 'You can only create purchase orders for your assigned location.' };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('create_draft_purchase_orders_from_reorder', {
    p_location_id: input.locationId,
    p_product_ids: input.productIds,
  });
  if (error) {
    return { ok: false, error: mapPurchasingRpcError(error, 'Could not create draft purchase orders.') };
  }
  const purchaseOrderIds = (data ?? []) as string[];
  revalidatePath('/purchasing/reorder');
  revalidatePath('/purchasing/purchase-orders');
  return { ok: true, purchaseOrderIds };
}

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

export async function receivePurchaseOrderAction(
  purchaseOrderId: string,
  _prev: PurchaseOrderActionResult | undefined,
  formData: FormData,
): Promise<PurchaseOrderActionResult> {
  const access = await getCurrentAccess();
  if (
    !hasPermission(access, 'purchasing.view') ||
    !hasPermission(access, 'purchasing.receive_po')
  ) {
    return { ok: false, error: 'You do not have permission to receive purchase orders.' };
  }

  let input: ReturnType<typeof parseReceiptForm>;
  try {
    input = parseReceiptForm(formData);
  } catch (error) {
    return validationError(error, 'Check the receipt details.');
  }

  const supabase = await createServerSupabaseClient();
  const purchaseOrder = await getPurchaseOrderDetail(supabase, access, purchaseOrderId);
  if (!purchaseOrder) return { ok: false, error: 'Purchase order not found.' };
  if (!purchaseOrder.actions.canReceive) {
    return { ok: false, error: 'This purchase order is not available for receiving.' };
  }

  for (const line of input.lines) {
    const currentLine = purchaseOrder.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);
    if (!currentLine) {
      return { ok: false, error: 'One of the selected receipt lines is not on this purchase order.' };
    }
    const outstandingQuantity = Math.max(
      0,
      currentLine.orderedQuantity - currentLine.receivedQuantity,
    );
    if (line.quantityReceived > outstandingQuantity) {
      return { ok: false, error: 'A receipt quantity exceeds the current outstanding quantity.' };
    }
  }

  const { error } = await supabase.rpc('receive_purchase_order', {
    p_request_id: randomUUID(),
    p_purchase_order_id: purchaseOrderId,
    p_lines: input.lines.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      quantityReceived: line.quantityReceived,
    })),
    p_supplier_delivery_reference: input.supplierDeliveryReference,
    p_notes: input.notes,
  });
  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not receive the purchase order.'),
    };
  }

  revalidatePurchaseOrder(purchaseOrderId);
  redirect(`/purchasing/purchase-orders/${purchaseOrderId}?received=1`);
}
