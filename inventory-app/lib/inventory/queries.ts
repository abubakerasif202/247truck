import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { hasPermission } from '@/lib/auth/permissions';
import type { UserAccessContext } from '@/lib/auth/types';
import type { LocationScope } from '@/lib/location/scope';
import type { ProductCategoryCode } from '@/lib/products/types';

export type InventorySummaryRow = {
  productId: string;
  name: string;
  categoryCode: ProductCategoryCode;
  partReference: string | null;
  sellingPriceInclGst: number | null;
  tyreCondition: 'new' | 'used' | null;
  brandName: string | null;
  patternName: string | null;
  sizeName: string | null;
  locationCode: 'LON' | 'REG';
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
  weightedAverageCost: number | null;
  minimumStock: number;
  reorderQuantity: number;
  lowStock: boolean;
};

type SummaryDbRow = {
  product_id: string;
  name: string;
  category_code: ProductCategoryCode;
  part_reference: string | null;
  selling_price_incl_gst: number | null;
  tyre_condition: 'new' | 'used' | null;
  brand_name: string | null;
  pattern_name: string | null;
  size_name: string | null;
  location_code: 'LON' | 'REG';
  location_name: string;
  on_hand: number;
  reserved: number;
  available: number;
  weighted_average_cost: number | null;
  minimum_stock: number;
  reorder_quantity: number;
  low_stock: boolean;
};

export type InventoryQuery = {
  scope: LocationScope;
  productId?: string;
  search?: string;
  category?: ProductCategoryCode;
  tyreCondition?: 'new' | 'used';
  lowStockOnly?: boolean;
  includeArchived?: boolean;
};

export type InventoryPage = {
  rows: InventorySummaryRow[];
  totalProducts: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

type SummaryPageDbRow = SummaryDbRow & { active: boolean };

type SummaryPageResult = {
  rows: SummaryPageDbRow[];
  total_products: number;
  offset: number;
  limit: number;
  has_more: boolean;
};

function mapRow(row: SummaryDbRow, canViewCost: boolean): InventorySummaryRow {
  return {
    productId: row.product_id,
    name: row.name,
    categoryCode: row.category_code,
    partReference: row.part_reference,
    sellingPriceInclGst:
      row.selling_price_incl_gst == null
        ? null
        : Number(row.selling_price_incl_gst),
    tyreCondition: row.tyre_condition,
    brandName: row.brand_name,
    patternName: row.pattern_name,
    sizeName: row.size_name,
    locationCode: row.location_code,
    locationName: row.location_name,
    onHand: row.on_hand,
    reserved: row.reserved,
    available: row.available,
    weightedAverageCost:
      canViewCost && row.weighted_average_cost != null
        ? Number(row.weighted_average_cost)
        : null,
    minimumStock: row.minimum_stock,
    reorderQuantity: row.reorder_quantity,
    lowStock: row.low_stock,
  };
}

export async function searchInventory(
  client: SupabaseClient,
  access: UserAccessContext,
  query: InventoryQuery & { page?: number; limit?: number },
): Promise<InventoryPage> {
  const canViewCost = hasPermission(access, 'inventory.view_cost');

  const page = query.page && query.page >= 1 ? Math.floor(query.page) : 1;
  const limit = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, query.limit ? Math.floor(query.limit) : DEFAULT_PAGE_LIMIT),
  );
  const offset = (page - 1) * limit;

  const { data, error } = await client.rpc('inventory_summary_page', {
    p_location_code: query.scope.kind === 'location' ? query.scope.code : null,
    p_product_id: query.productId ?? null,
    p_search: query.search?.trim() || null,
    p_category: query.category ?? null,
    p_tyre_condition: query.tyreCondition ?? null,
    p_low_stock_only: Boolean(query.lowStockOnly),
    p_include_archived: Boolean(query.includeArchived),
    p_offset: offset,
    p_limit: limit,
  });

  if (error) {
    console.error('[inventory] searchInventory failed', error.message, error.code);
    throw new Error('Could not load inventory.');
  }

  // inventory_summary_page returns a single jsonb object (not a set), but is
  // defensively unwrapped in case PostgREST ever wraps a scalar RPC result.
  const result = (Array.isArray(data) ? data[0] : data) as SummaryPageResult;
  return {
    rows: (result.rows ?? []).map((row) => mapRow(row, canViewCost)),
    totalProducts: Number(result.total_products ?? 0),
    page,
    limit,
    hasMore: Boolean(result.has_more),
  };
}

export type RecentMovement = {
  id: string;
  productName: string;
  locationCode: string;
  quantityDelta: number;
  movementType: string;
  createdAt: string;
};

export type DashboardInventoryMetrics = {
  activeProducts: number;
  totalOnHand: number;
  lowStockItems: number;
  inventoryValue: number | null;
  unvaluedUnits: number | null;
  recentMovements: RecentMovement[];
};

export async function getDashboardInventoryMetrics(
  client: SupabaseClient,
  access: UserAccessContext,
  scope: LocationScope,
): Promise<DashboardInventoryMetrics> {
  const totalsPromise = (async (): Promise<{
    activeProducts: number;
    totalOnHand: number;
    lowStockItems: number;
  }> => {
    const { data, error } = await client.rpc('inventory_dashboard_metrics', {
      p_location_code: scope.kind === 'location' ? scope.code : null,
    });
    if (error) {
      console.error('[inventory] dashboard metrics failed', error.message, error.code);
      throw new Error('Could not load dashboard metrics.');
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { active_products: number; total_on_hand: number; low_stock_items: number }
      | null;
    return {
      activeProducts: Number(row?.active_products ?? 0),
      totalOnHand: Number(row?.total_on_hand ?? 0),
      lowStockItems: Number(row?.low_stock_items ?? 0),
    };
  })();

  const canViewValuation =
    hasPermission(access, 'reports.view_inventory_value') &&
    hasPermission(access, 'inventory.view_cost');

  const valuationPromise = (async (): Promise<{
    inventoryValue: number | null;
    unvaluedUnits: number | null;
  }> => {
    if (!canViewValuation) {
      return { inventoryValue: null, unvaluedUnits: null };
    }

    const { data: valuation, error: valuationError } = await client.rpc(
      'inventory_valuation_for_scope',
      { p_location_code: scope.kind === 'location' ? scope.code : null },
    );
    if (valuationError) {
      console.error(
        '[inventory] inventory_valuation_for_scope failed',
        valuationError.message,
      );
      return { inventoryValue: null, unvaluedUnits: null };
    }

    const row = Array.isArray(valuation) ? valuation[0] : valuation;
    return {
      inventoryValue: Number(row?.known_value ?? 0),
      unvaluedUnits: Number(row?.unvalued_units ?? 0),
    };
  })();

  const recentMovementsPromise = (async (): Promise<RecentMovement[]> => {
    let movementQuery = client
      .from('inventory_movements')
      .select('id, quantity_delta, movement_type, created_at, location_id, products(name), locations(code)')
      .order('created_at', { ascending: false })
      .limit(10);

    // RLS already scopes Managers; add an explicit filter for an Admin single-branch view.
    if (scope.kind === 'location') {
      const { data: loc } = await client
        .from('locations')
        .select('id')
        .eq('code', scope.code)
        .maybeSingle<{ id: string }>();
      if (loc) movementQuery = movementQuery.eq('location_id', loc.id);
    }

    const { data: movementRows, error: movementError } = await movementQuery.returns<
      {
        id: string;
        quantity_delta: number;
        movement_type: string;
        created_at: string;
        location_id: string;
        products: { name: string } | null;
        locations: { code: string } | null;
      }[]
    >();
    if (movementError) {
      console.error('[inventory] recent movements failed', movementError.message);
      return [];
    }

    return (movementRows ?? []).map((m) => ({
      id: m.id,
      productName: m.products?.name ?? 'Unknown product',
      locationCode: m.locations?.code ?? '',
      quantityDelta: m.quantity_delta,
      movementType: m.movement_type,
      createdAt: m.created_at,
    }));
  })();

  const [totals, valuation, recentMovements] = await Promise.all([
    totalsPromise,
    valuationPromise,
    recentMovementsPromise,
  ]);

  return {
    activeProducts: totals.activeProducts,
    totalOnHand: totals.totalOnHand,
    lowStockItems: totals.lowStockItems,
    inventoryValue: valuation.inventoryValue,
    unvaluedUnits: valuation.unvaluedUnits,
    recentMovements,
  };
}
