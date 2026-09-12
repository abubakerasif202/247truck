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
