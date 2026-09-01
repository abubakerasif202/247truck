'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import type { PermissionKey } from '@/lib/auth/types';
import { actionError, type ActionResult } from '@/lib/action-result';
import {
  createUsedTyreUnitWithStock,
  postInventoryMovement,
  setInventoryCount,
} from '@/lib/inventory/repository';
import { resolveTargetLocation } from '@/lib/inventory/target-location';
import type { InventoryMutationResult } from '@/lib/inventory/types';
import {
  StockAdjustmentSchema,
  StockInSchema,
  StockOutSchema,
  UsedTyreIntakeSchema,
} from '@/lib/inventory/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type StockSuccess = InventoryMutationResult & { unitCode?: string };
type StockResult = ActionResult<StockSuccess>;

async function withStockContext(
  permission: PermissionKey,
): Promise<
  | { ok: true; access: Awaited<ReturnType<typeof getCurrentAccess>>; supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> }
  | { ok: false; result: StockResult }
> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, permission)) {
    return { ok: false, result: actionError('You do not have permission for this stock action.') };
  }
  const supabase = await createServerSupabaseClient();
  return { ok: true, access, supabase };
}

function invalid(error: z.ZodError): StockResult {
  return actionError('Please correct the highlighted fields.', z.flattenError(error).fieldErrors);
}

function revalidateStock(productId: string) {
  revalidatePath('/dashboard');
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${productId}`);
}

export async function stockInAction(
  _prev: StockResult | undefined,
  formData: FormData,
): Promise<StockResult> {
  const ctx = await withStockContext('inventory.stock_in');
  if (!ctx.ok) return ctx.result;

  const parsed = StockInSchema.safeParse({
    productId: formData.get('productId'),
    locationId: formData.get('locationId'),
    quantity: formData.get('quantity'),
    unitCost: formData.get('unitCost'),
    supplier: formData.get('supplier') || undefined,
    reference: formData.get('reference') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    const target = await resolveTargetLocation(ctx.supabase, ctx.access, formData.get('locationCode') as string);
    const data = await postInventoryMovement(ctx.supabase, {
      requestId: String(formData.get('requestId') ?? crypto.randomUUID()),
      productId: parsed.data.productId,
      locationId: target.id,
      quantityDelta: parsed.data.quantity,
      movementType: 'quick_stock_in',
      inboundUnitCost: parsed.data.unitCost,
      sourceType: 'quick_stock_in',
      sourceId: parsed.data.reference ?? null,
    });
    revalidateStock(parsed.data.productId);
    return { ok: true, data };
  } catch (error) {
    return actionError(error instanceof Error ? error.message : 'Stock-in failed.');
  }
}

export async function stockOutAction(
  _prev: StockResult | undefined,
  formData: FormData,
): Promise<StockResult> {
  const ctx = await withStockContext('inventory.stock_out');
  if (!ctx.ok) return ctx.result;

  const parsed = StockOutSchema.safeParse({
    productId: formData.get('productId'),
    locationId: formData.get('locationId'),
    quantity: formData.get('quantity'),
    reason: formData.get('reason'),
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    const target = await resolveTargetLocation(ctx.supabase, ctx.access, formData.get('locationCode') as string);
    const data = await postInventoryMovement(ctx.supabase, {
      requestId: String(formData.get('requestId') ?? crypto.randomUUID()),
      productId: parsed.data.productId,
      locationId: target.id,
      quantityDelta: -parsed.data.quantity,
      movementType: 'stock_out',
      reason: parsed.data.reason,
      sourceType: 'stock_out',
    });
    revalidateStock(parsed.data.productId);
    return { ok: true, data };
  } catch (error) {
    return actionError(error instanceof Error ? error.message : 'Stock-out failed.');
  }
}

export async function adjustStockAction(
  _prev: StockResult | undefined,
  formData: FormData,
): Promise<StockResult> {
  const ctx = await withStockContext('inventory.adjust');
  if (!ctx.ok) return ctx.result;

  const parsed = StockAdjustmentSchema.safeParse({
    productId: formData.get('productId'),
    locationId: formData.get('locationId'),
    countedQuantity: formData.get('countedQuantity'),
    reason: formData.get('reason'),
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    const target = await resolveTargetLocation(ctx.supabase, ctx.access, formData.get('locationCode') as string);
    const data = await setInventoryCount(ctx.supabase, {
      requestId: String(formData.get('requestId') ?? crypto.randomUUID()),
      productId: parsed.data.productId,
      locationId: target.id,
      countedQuantity: parsed.data.countedQuantity,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
    });
    revalidateStock(parsed.data.productId);
    return { ok: true, data };
  } catch (error) {
    return actionError(error instanceof Error ? error.message : 'Adjustment failed.');
  }
}

export async function usedTyreIntakeAction(
  _prev: StockResult | undefined,
  formData: FormData,
): Promise<StockResult> {
  const ctx = await withStockContext('inventory.stock_in');
  if (!ctx.ok) return ctx.result;

  const parsed = UsedTyreIntakeSchema.safeParse({
    productId: formData.get('productId'),
    locationId: formData.get('locationId'),
    treadDepthMm: formData.get('treadDepthMm'),
    condition: formData.get('condition'),
    costBasis: formData.get('costBasis'),
    sellingPriceOverride: formData.get('sellingPriceOverride') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    const target = await resolveTargetLocation(ctx.supabase, ctx.access, formData.get('locationCode') as string);
    const result = await createUsedTyreUnitWithStock(ctx.supabase, {
      requestId: String(formData.get('requestId') ?? crypto.randomUUID()),
      productId: parsed.data.productId,
      locationId: target.id,
      treadDepthMm: parsed.data.treadDepthMm,
      condition: parsed.data.condition,
      costBasis: parsed.data.costBasis,
      sellingPriceOverride: parsed.data.sellingPriceOverride ?? null,
      notes: parsed.data.notes ?? null,
    });
    revalidateStock(parsed.data.productId);
    return { ok: true, data: { ...result.inventory, unitCode: result.unitCode } };
  } catch (error) {
    return actionError(error instanceof Error ? error.message : 'Used-tyre intake failed.');
  }
}

const ReorderSchema = z.object({
  productId: z.uuid(),
  locationCode: z.enum(['LON', 'REG']),
  minimumStock: z.coerce.number().int().min(0),
  reorderQuantity: z.coerce.number().int().min(0),
});

export async function updateReorderSettingsAction(
  _prev: ActionResult<null> | undefined,
  formData: FormData,
): Promise<ActionResult<null>> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return actionError('Only Admins can edit reorder thresholds.');
  }

  const parsed = ReorderSchema.safeParse({
    productId: formData.get('productId'),
    locationCode: formData.get('locationCode'),
    minimumStock: formData.get('minimumStock'),
    reorderQuantity: formData.get('reorderQuantity'),
  });
  if (!parsed.success) return invalid(parsed.error) as ActionResult<null>;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('set_reorder_settings', {
    p_product_id: parsed.data.productId,
    p_location_code: parsed.data.locationCode,
    p_minimum_stock: parsed.data.minimumStock,
    p_reorder_quantity: parsed.data.reorderQuantity,
  });
  if (error) {
    console.error('[inventory] set_reorder_settings failed', error.message);
    return actionError('Could not save the reorder thresholds.');
  }

  revalidatePath(`/inventory/${parsed.data.productId}`);
  return { ok: true, data: null };
}
