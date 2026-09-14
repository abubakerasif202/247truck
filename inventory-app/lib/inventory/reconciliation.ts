import 'server-only';

import { createServerSupabaseClient } from '@/lib/supabase/server';

export type InventoryReconciliationRow = {
  productId: string;
  productName: string;
  partReference: string | null;
  locationId: string;
  locationCode: string;
  locationName: string;
  storedQuantity: number;
  ledgerQuantity: number;
  variance: number;
  status: 'matched' | 'overstated' | 'understated';
};

type ReconcileInventoryLedgerRow = {
  product_id: string;
  product_name: string;
  part_reference: string | null;
  location_id: string;
  location_code: string;
  location_name: string;
  stored_quantity: number;
  ledger_quantity: number;
  variance: number;
  status: string;
};

/**
 * Read-only comparison of stored on-hand balances against the sum of the
 * inventory_movements ledger. The RPC is admin-gated server-side; a
 * non-admin call returns ACCESS_DENIED rather than an empty result, so a
 * failure here should not be presented as "no discrepancies found".
 */
export async function getInventoryReconciliation(): Promise<
  { ok: true; data: InventoryReconciliationRow[] } | { ok: false; error: string }
> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('reconcile_inventory_ledger');

  if (error) {
    if (error.message?.includes('ACCESS_DENIED')) {
      return { ok: false, error: 'You do not have permission to view inventory reconciliation.' };
    }
    return { ok: false, error: 'Could not load the reconciliation report. Please refresh.' };
  }

  const rows = (data ?? []) as ReconcileInventoryLedgerRow[];
  return {
    ok: true,
    data: rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      partReference: row.part_reference,
      locationId: row.location_id,
      locationCode: row.location_code,
      locationName: row.location_name,
      storedQuantity: row.stored_quantity,
      ledgerQuantity: row.ledger_quantity,
      variance: row.variance,
      status: row.status as InventoryReconciliationRow['status'],
    })),
  };
}

export type AdelaideReconciliationRow = {
  severity: 'critical' | 'warning' | 'info';
  discrepancyType: string;
  externalOrderReference: string | null;
  reservationId: string | null;
  mappingId: string | null;
  inventoryProductId: string | null;
  requestId: string | null;
  expectedQuantity: number | null;
  actualQuantity: number | null;
  guidance: string;
};

export type AdelaideMappingHealthRow = {
  websiteProductId: string;
  mappingId: string | null;
  inventoryProductId: string | null;
  active: boolean;
  sellable: boolean;
  status: 'valid' | 'invalid';
  issue: string | null;
};

export async function getAdelaideReconciliation(): Promise<
  { ok: true; data: AdelaideReconciliationRow[] } | { ok: false; error: string }
> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('admin_adelaide_reconciliation');
  if (error) return { ok: false, error: 'Could not load website integration reconciliation.' };
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      severity: String(row.severity) as AdelaideReconciliationRow['severity'],
      discrepancyType: String(row.discrepancy_type),
      externalOrderReference: row.external_order_reference ? String(row.external_order_reference) : null,
      reservationId: row.reservation_id ? String(row.reservation_id) : null,
      mappingId: row.mapping_id ? String(row.mapping_id) : null,
      inventoryProductId: row.inventory_product_id ? String(row.inventory_product_id) : null,
      requestId: row.request_id ? String(row.request_id) : null,
      expectedQuantity: row.expected_quantity == null ? null : Number(row.expected_quantity),
      actualQuantity: row.actual_quantity == null ? null : Number(row.actual_quantity),
      guidance: String(row.guidance),
    })),
  };
}

export async function getAdelaideMappingHealth(): Promise<
  { ok: true; data: AdelaideMappingHealthRow[] } | { ok: false; error: string }
> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('admin_adelaide_mapping_health');
  if (error) return { ok: false, error: 'Could not load product mapping health.' };
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      websiteProductId: String(row.website_product_id),
      mappingId: row.mapping_id ? String(row.mapping_id) : null,
      inventoryProductId: row.inventory_product_id ? String(row.inventory_product_id) : null,
      active: Boolean(row.active),
      sellable: Boolean(row.sellable),
      status: String(row.status) as AdelaideMappingHealthRow['status'],
      issue: row.issue ? String(row.issue) : null,
    })),
  };
}
