import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[inventory RPC] skipped: missing ${gap.join(', ')}\n`);
}

suite('post_inventory_movement + set_inventory_count', () => {
  let t: TestTenants;
  let productId: string;

  async function post(args: Record<string, unknown>) {
    return t.lon.rpc('post_inventory_movement', {
      p_reason: null,
      p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
      ...args,
    });
  }

  async function balance() {
    const { data } = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single<{ on_hand: number; weighted_average_cost: number }>();
    return {
      onHand: data!.on_hand,
      wac: Number(data!.weighted_average_cost),
    };
  }

  async function movementCount() {
    const { count } = await t.service
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId);
    return count ?? 0;
  }

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.stock_in', 'inventory.stock_out', 'inventory.adjust'],
    });
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: 'Continental HSR2 315/80R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 720,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Continental',
      p_tyre_size: '315/80R22.5',
    });
    if (error) throw error;
    productId = data as string;
  });

  // The inventory ledger is append-only and products with movements cannot be
  // deleted (soft-delete semantics, spec 37). Assertions are scoped by
  // product_id / request_id; run `npx supabase db reset` before the integration
  // suite for a clean slate (see the plan's Task 6 verification steps).
  afterAll(async () => {
    await t?.cleanup();
  });

  it('recalculates WAC on inbound stock and preserves it on outbound', async () => {
    const first = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 10,
      p_movement_type: 'quick_stock_in',
      p_inbound_unit_cost: 400,
    });
    expect(first.error).toBeNull();
    expect(await balance()).toEqual({ onHand: 10, wac: 400 });

    await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 10,
      p_movement_type: 'quick_stock_in',
      p_inbound_unit_cost: 500,
    });
    expect(await balance()).toEqual({ onHand: 20, wac: 450 });

    const outboundRequest = randomUUID();
    await post({
      p_request_id: outboundRequest,
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: -2,
      p_movement_type: 'stock_out',
      p_reason: 'damaged',
    });
    expect(await balance()).toEqual({ onHand: 18, wac: 450 });

    // Over-sell is rejected and leaves the balance untouched.
    const oversell = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: -19,
      p_movement_type: 'stock_out',
      p_reason: 'damaged',
    });
    expect(oversell.error?.message).toContain('INSUFFICIENT_STOCK');
    expect(await balance()).toEqual({ onHand: 18, wac: 450 });

    // Replaying the same request_id does not post a second movement.
    const before = await movementCount();
    const replay = await post({
      p_request_id: outboundRequest,
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: -2,
      p_movement_type: 'stock_out',
      p_reason: 'damaged',
    });
    expect(replay.error).toBeNull();
    expect(await movementCount()).toBe(before);
    expect(await balance()).toEqual({ onHand: 18, wac: 450 });
  });

  it('rejects a stock_out with a positive delta (no stock creation from nothing)', async () => {
    const before = await balance();
    const result = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 50,
      p_movement_type: 'stock_out',
      p_reason: 'damaged',
    });
    expect(result.error?.message).toContain('INVALID_MOVEMENT_DIRECTION');
    expect(await balance()).toEqual(before);
  });

  it('rejects a quick_stock_in with a negative delta', async () => {
    const result = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: -5,
      p_movement_type: 'quick_stock_in',
      p_inbound_unit_cost: 100,
    });
    expect(result.error?.message).toContain('INVALID_MOVEMENT_DIRECTION');
  });

  it('still rejects Quick Stock In when inbound cost is unknown', async () => {
    const result = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 1,
      p_movement_type: 'quick_stock_in',
      p_inbound_unit_cost: null,
    });
    expect(result.error?.message).toContain('INBOUND_COST_REQUIRED');
  });

  it('requires a reason for adjustments', async () => {
    const result = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 1,
      p_movement_type: 'adjustment',
      p_reason: '   ',
    });
    expect(result.error?.message).toContain('REASON_REQUIRED');
  });

  it('set_inventory_count computes the delta and rejects a no-op count', async () => {
    const noop = await t.lon.rpc('set_inventory_count', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_counted_quantity: 18,
      p_reason: 'Physical count',
      p_notes: null,
    });
    expect(noop.error?.message).toContain('NO_STOCK_CHANGE');

    const applied = await t.lon.rpc('set_inventory_count', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_counted_quantity: 17,
      p_reason: 'Physical count correction',
      p_notes: 'One tyre unaccounted',
    });
    expect(applied.error).toBeNull();
    expect(await balance()).toEqual({ onHand: 17, wac: 450 });
  });

  it('forbids a Manager posting to another branch', async () => {
    const result = await post({
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity_delta: 5,
      p_movement_type: 'quick_stock_in',
      p_inbound_unit_cost: 100,
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
  });

  it('forbids a Manager without the stock_in permission', async () => {
    const result = await t.reg.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.regLocationId,
      p_quantity_delta: 5,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: 100,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
    expect(result.error?.message).toContain('ACCESS_DENIED');
  });
});
