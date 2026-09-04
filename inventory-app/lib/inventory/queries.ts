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

/**
 * Prepares a term for a PostgREST `ilike` filter value: escape LIKE wildcards
 * AND the double-quote/backslash so the term can be safely wrapped in quotes,
 * which stops `,` `(` `)` `.` from being read as filter grammar.
 */
function likeTerm(value: string): string {
  const escaped = value.replace(/[\\%_"]/g, (char) => `\\${char}`);
  return `"%${escaped}%"`;
}

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
  query: InventoryQuery,
): Promise<InventorySummaryRow[]> {
  const canViewCost = hasPermission(access, 'inventory.view_cost');

  let q = client
    .from('inventory_product_summary')
    .select('*')
    .order('name')
    .order('location_code');

  if (!query.includeArchived) q = q.eq('active', true);
  if (query.productId) q = q.eq('product_id', query.productId);
  if (query.scope.kind === 'location') q = q.eq('location_code', query.scope.code);
  if (query.category) q = q.eq('category_code', query.category);
  if (query.tyreCondition) q = q.eq('tyre_condition', query.tyreCondition);
  if (query.lowStockOnly) q = q.eq('low_stock', true);

  const search = query.search?.trim();
  if (search) {
    const term = likeTerm(search);
    q = q.or(
      [
        `name.ilike.${term}`,
        `part_reference.ilike.${term}`,
        `brand_name.ilike.${term}`,
        `pattern_name.ilike.${term}`,
        `size_name.ilike.${term}`,
      ].join(','),
    );
  }

  const { data, error } = await q.returns<SummaryDbRow[]>();
  if (error) {
    console.error('[inventory] searchInventory failed', error.message);
    throw new Error('Could not load inventory.');
  }
  return (data ?? []).map((row) => mapRow(row, canViewCost));
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
  recentMovements: RecentMovement[];
};

export async function getDashboardInventoryMetrics(
  client: SupabaseClient,
  access: UserAccessContext,
  scope: LocationScope,
): Promise<DashboardInventoryMetrics> {
  let countQuery = client
    .from('inventory_product_summary')
    .select('product_id, on_hand, low_stock')
    .eq('active', true);
  if (scope.kind === 'location') {
    countQuery = countQuery.eq('location_code', scope.code);
  }
  const { data: countRows, error: countError } = await countQuery.returns<
    { product_id: string; on_hand: number; low_stock: boolean }[]
  >();
  if (countError) {
    console.error('[inventory] dashboard metrics failed', countError.message);
    throw new Error('Could not load dashboard metrics.');
  }

  const rows = countRows ?? [];
  const productIds = new Set(rows.map((r) => r.product_id));
  const totalOnHand = rows.reduce((acc, r) => acc + r.on_hand, 0);
  const lowStockItems = rows.filter((r) => r.low_stock).length;

  // Inventory value comes from a permission-gated RPC so raw per-row WAC is
  // never exposed to a Manager who only holds reports.view_inventory_value.
  let inventoryValue: number | null = null;
  if (hasPermission(access, 'reports.view_inventory_value')) {
    const { data: value, error: valueError } = await client.rpc(
      'inventory_value_for_scope',
      { p_location_code: scope.kind === 'location' ? scope.code : null },
    );
    if (valueError) {
      console.error('[inventory] inventory_value_for_scope failed', valueError.message);
    } else {
      inventoryValue = Number(value ?? 0);
    }
  }

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
  }

  const recentMovements: RecentMovement[] = (movementRows ?? []).map((m) => ({
    id: m.id,
    productName: m.products?.name ?? 'Unknown product',
    locationCode: m.locations?.code ?? '',
    quantityDelta: m.quantity_delta,
    movementType: m.movement_type,
    createdAt: m.created_at,
  }));

  return {
    activeProducts: productIds.size,
    totalOnHand,
    lowStockItems,
    inventoryValue,
    recentMovements,
  };
}
