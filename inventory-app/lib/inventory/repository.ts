import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { friendlyInventoryError } from './errors';
import type {
  InventoryBalance,
  InventoryMutationResult,
  PostMovementInput,
  SetInventoryCountInput,
  UsedTyreIntakeInput,
} from './types';

type MutationRow = {
  movement_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  weighted_average_cost: number;
};

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

function toResult(row: MutationRow): InventoryMutationResult {
  return {
    movementId: row.movement_id,
    onHand: row.on_hand,
    reserved: row.reserved,
    available: row.available,
    weightedAverageCost: Number(row.weighted_average_cost),
  };
}

function single<T>(data: T[] | T | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new InventoryError('The stock action returned no result.');
  return row;
}

export async function postInventoryMovement(
  client: SupabaseClient,
  input: PostMovementInput,
): Promise<InventoryMutationResult> {
  const { data, error } = await client.rpc('post_inventory_movement', {
    p_request_id: input.requestId,
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_quantity_delta: input.quantityDelta,
    p_movement_type: input.movementType,
    p_reason: input.reason ?? null,
    p_inbound_unit_cost: input.inboundUnitCost ?? null,
    p_used_tyre_unit_id: input.usedTyreUnitId ?? null,
    p_source_type: input.sourceType ?? null,
    p_source_id: input.sourceId ?? null,
  });

  if (error) {
    console.error('[inventory] post_inventory_movement failed', error.message);
    throw new InventoryError(friendlyInventoryError(error.message));
  }
  return toResult(single<MutationRow>(data));
}

export async function setInventoryCount(
  client: SupabaseClient,
  input: SetInventoryCountInput,
): Promise<InventoryMutationResult> {
  const { data, error } = await client.rpc('set_inventory_count', {
    p_request_id: input.requestId,
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_counted_quantity: input.countedQuantity,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  });

  if (error) {
    console.error('[inventory] set_inventory_count failed', error.message);
    throw new InventoryError(friendlyInventoryError(error.message));
  }
  return toResult(single<MutationRow>(data));
}

export async function createUsedTyreUnitWithStock(
  client: SupabaseClient,
  input: UsedTyreIntakeInput,
): Promise<{ unitId: string; unitCode: string; inventory: InventoryMutationResult }> {
  const { data, error } = await client.rpc('create_used_tyre_unit_with_stock', {
    p_request_id: input.requestId,
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_tread_depth_mm: input.treadDepthMm,
    p_condition: input.condition,
    p_cost_basis: input.costBasis,
    p_selling_price_override: input.sellingPriceOverride ?? null,
    p_notes: input.notes ?? null,
  });

  if (error) {
    console.error('[inventory] create_used_tyre_unit_with_stock failed', error.message);
    throw new InventoryError(friendlyInventoryError(error.message));
  }

  const row = single<MutationRow & { unit_id: string; unit_code: string }>(data);
  return {
    unitId: row.unit_id,
    unitCode: row.unit_code,
    inventory: toResult(row),
  };
}

export async function getInventoryBalance(
  client: SupabaseClient,
  productId: string,
  locationId: string,
): Promise<InventoryBalance> {
  const { data, error } = await client
    .from('inventory_balances')
    .select('on_hand, reserved, weighted_average_cost')
    .eq('product_id', productId)
    .eq('location_id', locationId)
    .maybeSingle<{
      on_hand: number;
      reserved: number;
      weighted_average_cost: number;
    }>();

  if (error) {
    console.error('[inventory] getInventoryBalance failed', error.message);
    throw new InventoryError('Could not load the stock balance.');
  }

  const onHand = data?.on_hand ?? 0;
  const reserved = data?.reserved ?? 0;
  return {
    onHand,
    reserved,
    available: onHand - reserved,
    weightedAverageCost: Number(data?.weighted_average_cost ?? 0),
  };
}
