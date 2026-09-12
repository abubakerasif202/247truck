import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[inventory reconciliation] skipped: missing ${gap.join(', ')}\n`);
}

type ReconciliationRow = {
  product_id: string;
  location_id: string;
  stored_quantity: number;
  ledger_quantity: number;
  variance: number;
  status: 'matched' | 'overstated' | 'understated';
};

suite('reconcile_inventory_ledger', () => {
  let t: TestTenants;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.stock_in', 'inventory.stock_out', 'inventory.adjust'],
    });
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: 'Bridgestone R150 11R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 650,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Bridgestone',
      p_tyre_size: '11R22.5',
    });
    if (error) throw error;
    productId = data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('denies non-admin callers', async () => {
    const { error } = await t.reg.rpc('reconcile_inventory_ledger');
    expect(error?.message).toContain('ACCESS_DENIED');
  });

  it('reports a matched row after a normal stock-in movement (balance follows the ledger)', async () => {
    const { error } = await t.lon.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 5,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: 400,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
    expect(error).toBeNull();

    const { data, error: reconcileError } = await t.admin.rpc('reconcile_inventory_ledger');
    expect(reconcileError).toBeNull();
    const row = (data as ReconciliationRow[]).find(
      (r) => r.product_id === productId && r.location_id === t.lonLocationId,
    );
    expect(row).toBeDefined();
    expect(row!.stored_quantity).toBe(row!.ledger_quantity);
    expect(row!.variance).toBe(0);
    expect(row!.status).toBe('matched');
  });

  it('reflects a further adjustment while stock and ledger stay in lockstep', async () => {
    const { error } = await t.lon.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: -2,
      p_movement_type: 'adjustment',
      p_reason: 'stocktake correction',
      p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
    expect(error).toBeNull();

    const { data } = await t.admin.rpc('reconcile_inventory_ledger');
    const row = (data as ReconciliationRow[]).find(
      (r) => r.product_id === productId && r.location_id === t.lonLocationId,
    );
    expect(row!.stored_quantity).toBe(3);
    expect(row!.ledger_quantity).toBe(3);
    expect(row!.status).toBe('matched');
  });

  it('flags an overstated balance when it drifts above the ledger total', async () => {
    const { data: before } = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single<{ on_hand: number }>();

    // Simulate drift with raw SQL, bypassing every sanctioned RPC (the
    // service role deliberately has no UPDATE on inventory_balances) —
    // reconciliation must be the thing that notices this, not merely restate
    // the (now-drifted) stored balance.
    sql(`update public.inventory_balances set on_hand = on_hand + 4 where product_id='${productId}' and location_id='${t.lonLocationId}'`);

    const { data } = await t.admin.rpc('reconcile_inventory_ledger');
    const row = (data as ReconciliationRow[]).find(
      (r) => r.product_id === productId && r.location_id === t.lonLocationId,
    );
    expect(row!.variance).toBe(4);
    expect(row!.status).toBe('overstated');

    // Restore the balance so later tests in this file see a consistent state.
    sql(`update public.inventory_balances set on_hand = ${before!.on_hand} where product_id='${productId}' and location_id='${t.lonLocationId}'`);
  });

  it('flags an understated balance when it drifts below the ledger total', async () => {
    const { data: before } = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single<{ on_hand: number }>();

    // Simulate drift with raw SQL, bypassing every sanctioned RPC (the
    // service role deliberately has no UPDATE on inventory_balances) —
    // reconciliation must be the thing that notices this, not merely restate
    // the (now-drifted) stored balance.
    sql(`update public.inventory_balances set on_hand = on_hand - 1 where product_id='${productId}' and location_id='${t.lonLocationId}'`);

    const { data } = await t.admin.rpc('reconcile_inventory_ledger');
    const row = (data as ReconciliationRow[]).find(
      (r) => r.product_id === productId && r.location_id === t.lonLocationId,
    );
    expect(row!.variance).toBe(-1);
    expect(row!.status).toBe('understated');

    sql(`update public.inventory_balances set on_hand = ${before!.on_hand} where product_id='${productId}' and location_id='${t.lonLocationId}'`);
  });

  it('is read-only: calling it does not change any balance', async () => {
    const before = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single<{ on_hand: number }>();

    await t.admin.rpc('reconcile_inventory_ledger');
    await t.admin.rpc('reconcile_inventory_ledger');

    const after = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single<{ on_hand: number }>();
    expect(after.data?.on_hand).toBe(before.data?.on_hand);
  });
});
