import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { hasPermission } from '@/lib/auth/permissions';
import type { UserAccessContext } from '@/lib/auth/types';
import type { LocationScope } from '@/lib/location/scope';
import { PRODUCT_CATEGORY_LABELS, type ProductCategoryCode } from '@/lib/products/types';

import type {
  FastMovingProduct,
  InventoryByCategoryRow,
  InventoryDistributionRow,
  MovementPeriod,
  PurchasingAnalyticsSummary,
  ReceivablesAnalyticsSummary,
  SlowMovingProduct,
  SlowMovingWindow,
  StockMovementSummary,
} from './types';

/**
 * Whether the caller may see aggregated dollar figures. Mirrors
 * getDashboardInventoryMetrics's conjunction (lib/inventory/queries.ts) —
 * `reports.view_inventory_value` gates the report surface, `inventory.view_cost`
 * gates the underlying cost data. Both are required; neither alone is enough.
 */
function canViewValuation(access: UserAccessContext): boolean {
  return (
    hasPermission(access, 'reports.view_inventory_value') &&
    hasPermission(access, 'inventory.view_cost')
  );
}

/**
 * Strips known_inventory_value at the mapping boundary when the caller lacks
 * valuation permission, regardless of what the RPC returned. The RPC already
 * redacts per-row cost via public.inventory_product_summary (which nulls
 * weighted_average_cost without inventory.view_cost), but that only covers
 * the `inventory.view_cost` half of the conjunction — `reports.view_inventory_value`
 * is enforced here, once, so every caller of this module gets it automatically
 * instead of remembering to check it at each call site.
 */
function redactValue<T extends { knownInventoryValue: number | null }>(
  row: T,
  canView: boolean,
): T {
  return canView ? row : { ...row, knownInventoryValue: null };
}

type DistributionDbRow = {
  product_count: number | string;
  on_hand: number | string;
  available: number | string;
  low_stock_count: number | string;
  known_inventory_value: number | string | null;
};

function mapDistributionRow(
  row: DistributionDbRow,
  groupLabel: string,
): InventoryDistributionRow {
  return {
    groupLabel,
    productCount: Number(row.product_count),
    onHand: Number(row.on_hand),
    available: Number(row.available),
    lowStockCount: Number(row.low_stock_count),
    knownInventoryValue:
      row.known_inventory_value == null ? null : Number(row.known_inventory_value),
  };
}

export async function getInventoryByBrand(
  client: SupabaseClient,
  access: UserAccessContext,
  scope: LocationScope,
): Promise<InventoryDistributionRow[]> {
  const { data, error } = await client.rpc('inventory_analytics_by_brand', {
    p_location_code: scope.kind === 'location' ? scope.code : null,
  });
  if (error) {
    console.error('[analytics] inventory_analytics_by_brand failed', error.message);
    throw new Error('Could not load inventory by brand.');
  }
  const canView = canViewValuation(access);
  return ((data ?? []) as (DistributionDbRow & { brand_name: string })[]).map((row) =>
    redactValue(mapDistributionRow(row, row.brand_name), canView),
  );
}

export async function getInventoryBySize(
  client: SupabaseClient,
  access: UserAccessContext,
  scope: LocationScope,
): Promise<InventoryDistributionRow[]> {
  const { data, error } = await client.rpc('inventory_analytics_by_size', {
    p_location_code: scope.kind === 'location' ? scope.code : null,
  });
  if (error) {
    console.error('[analytics] inventory_analytics_by_size failed', error.message);
    throw new Error('Could not load inventory by size.');
  }
  const canView = canViewValuation(access);
  return ((data ?? []) as (DistributionDbRow & { size_name: string })[]).map((row) =>
    redactValue(mapDistributionRow(row, row.size_name), canView),
  );
}

export async function getInventoryByCategory(
  client: SupabaseClient,
  access: UserAccessContext,
  scope: LocationScope,
): Promise<InventoryByCategoryRow[]> {
  const { data, error } = await client.rpc('inventory_analytics_by_category', {
    p_location_code: scope.kind === 'location' ? scope.code : null,
  });
  if (error) {
    console.error('[analytics] inventory_analytics_by_category failed', error.message);
    throw new Error('Could not load inventory by category.');
  }
  const canView = canViewValuation(access);
  return (
    (data ?? []) as (DistributionDbRow & {
      category_code: ProductCategoryCode | null;
      out_of_stock_count: number | string;
    })[]
  ).map((row) => {
    const label = row.category_code ? PRODUCT_CATEGORY_LABELS[row.category_code] : 'Uncategorised';
    return redactValue(
      {
        ...mapDistributionRow(row, label),
        categoryCode: row.category_code,
        outOfStockCount: Number(row.out_of_stock_count),
      },
      canView,
    );
  });
}

export async function getStockMovementSummary(
  client: SupabaseClient,
  scope: LocationScope,
  periodDays: MovementPeriod,
): Promise<StockMovementSummary> {
  const { data, error } = await client.rpc('stock_movement_summary', {
    p_location_code: scope.kind === 'location' ? scope.code : null,
    p_days: periodDays,
  });
  if (error) {
    console.error('[analytics] stock_movement_summary failed', error.message);
    throw new Error('Could not load stock movement summary.');
  }
  const buckets = (
    (data ?? []) as { movement_type: string; movement_count: number | string; total_quantity: number | string }[]
  ).map((row) => ({
    movementType: row.movement_type,
    movementCount: Number(row.movement_count),
    totalQuantity: Number(row.total_quantity),
  }));

  const sumTypes = (types: string[]) =>
    buckets
      .filter((b) => types.includes(b.movementType))
      .reduce((total, b) => total + Math.abs(b.totalQuantity), 0);

  return {
    periodDays,
    buckets,
    stockInUnits: sumTypes(['quick_stock_in', 'used_unit_in', 'purchase_receipt', 'opening_stock', 'transfer_in', 'customer_return']),
    stockOutUnits: sumTypes(['stock_out', 'used_unit_out', 'transfer_out']),
    adjustmentUnits: sumTypes(['adjustment']),
  };
}

export async function getFastMovingProducts(
  client: SupabaseClient,
  scope: LocationScope,
  periodDays: MovementPeriod,
  limit = 20,
): Promise<FastMovingProduct[]> {
  const { data, error } = await client.rpc('fast_moving_products', {
    p_location_code: scope.kind === 'location' ? scope.code : null,
    p_days: periodDays,
    p_limit: limit,
  });
  if (error) {
    console.error('[analytics] fast_moving_products failed', error.message);
    throw new Error('Could not load fast-moving products.');
  }
  return (
    (data ?? []) as {
      product_id: string;
      product_name: string;
      brand_name: string | null;
      size_name: string | null;
      location_code: string;
      quantity_moved: number | string;
      movement_count: number | string;
      on_hand: number;
      minimum_stock: number;
    }[]
  ).map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    brandName: row.brand_name,
    sizeName: row.size_name,
    locationCode: row.location_code,
    quantityMoved: Number(row.quantity_moved),
    movementCount: Number(row.movement_count),
    onHand: row.on_hand,
    minimumStock: row.minimum_stock,
  }));
}

export async function getSlowMovingProducts(
  client: SupabaseClient,
  scope: LocationScope,
  inactivityDays: SlowMovingWindow,
): Promise<SlowMovingProduct[]> {
  const { data, error } = await client.rpc('slow_moving_products', {
    p_location_code: scope.kind === 'location' ? scope.code : null,
    p_days: inactivityDays,
  });
  if (error) {
    console.error('[analytics] slow_moving_products failed', error.message);
    throw new Error('Could not load slow-moving stock.');
  }
  return (
    (data ?? []) as {
      product_id: string;
      product_name: string;
      brand_name: string | null;
      size_name: string | null;
      location_code: string;
      on_hand: number;
      last_outward_movement_at: string | null;
      days_since_last_movement: number | null;
      never_moved: boolean;
    }[]
  ).map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    brandName: row.brand_name,
    sizeName: row.size_name,
    locationCode: row.location_code,
    onHand: row.on_hand,
    lastOutwardMovementAt: row.last_outward_movement_at,
    daysSinceLastMovement: row.days_since_last_movement,
    neverMoved: row.never_moved,
  }));
}

export async function getPurchasingAnalyticsSummary(
  client: SupabaseClient,
  locationId: string | null,
): Promise<PurchasingAnalyticsSummary> {
  const { data, error } = await client.rpc('purchasing_analytics_summary', {
    p_location_id: locationId,
  });
  if (error) {
    console.error('[analytics] purchasing_analytics_summary failed', error.message);
    throw new Error('Could not load purchasing analytics.');
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { open_purchase_orders: number | string; outstanding_po_units: number | string }
    | null;
  return {
    openPurchaseOrders: Number(row?.open_purchase_orders ?? 0),
    outstandingPoUnits: Number(row?.outstanding_po_units ?? 0),
  };
}

export async function getReceivablesAnalyticsSummary(
  client: SupabaseClient,
  access: UserAccessContext,
  locationId: string | null,
): Promise<ReceivablesAnalyticsSummary | null> {
  if (!hasPermission(access, 'receivables.view')) return null;

  const { data, error } = await client.rpc('receivables_analytics_summary', {
    p_location_id: locationId,
  });
  if (error) {
    console.error('[analytics] receivables_analytics_summary failed', error.message);
    throw new Error('Could not load receivables analytics.');
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        outstanding_receivables: number | string;
        overdue_receivables: number | string;
        outstanding_invoice_count: number | string;
        overdue_invoice_count: number | string;
      }
    | null;
  return {
    outstandingReceivables: Number(row?.outstanding_receivables ?? 0),
    overdueReceivables: Number(row?.overdue_receivables ?? 0),
    outstandingInvoiceCount: Number(row?.outstanding_invoice_count ?? 0),
    overdueInvoiceCount: Number(row?.overdue_invoice_count ?? 0),
  };
}
