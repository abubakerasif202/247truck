import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[inventory concurrency] skipped: missing ${gap.join(', ')}\n`);
}

suite('inventory ledger concurrency', () => {
  let t: TestTenants;
  let productId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.stock_in', 'inventory.stock_out'],
    });
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: 'Hankook AL10 295/80R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 610,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Hankook',
      p_tyre_size: '295/80R22.5',
    });
    if (error) throw error;
    productId = data as string;

    await t.lon.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: 2,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: 300,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
  });

  // Append-only ledger: see the note in inventory-rpc.test.ts. Reset the local
  // DB before the integration suite.
  afterAll(async () => {
    await t?.cleanup();
  });

  async function onHand() {
    const { data } = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .single<{ on_hand: number }>();
    return data!.on_hand;
  }

  async function stockOut(delta: number) {
    const res = await t.lon.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: t.lonLocationId,
      p_quantity_delta: delta,
      p_movement_type: 'stock_out',
      p_reason: 'damaged',
      p_inbound_unit_cost: null,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
    return { delta, ok: res.error === null, error: res.error?.message };
  }

  it('serialises racing over-lapping stock-outs across repeated rounds', async () => {
    for (let round = 0; round < 12; round += 1) {
      const start = await onHand();
      // Two concurrent outs that cannot both fit (start is small, e.g. 2 or 3).
      const results = await Promise.all([stockOut(-2), stockOut(-1)]);
      const winners = results.filter((r) => r.ok);
      const losers = results.filter((r) => !r.ok);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]?.error).toContain('INSUFFICIENT_STOCK');

      const end = await onHand();
      expect(end).toBe(start + winners[0]!.delta);
      expect(end).toBeGreaterThanOrEqual(0);

      // Restore on-hand to 2 for the next round (delta is +1 or +2).
      await t.lon.rpc('post_inventory_movement', {
        p_request_id: randomUUID(),
        p_product_id: productId,
        p_location_id: t.lonLocationId,
        p_quantity_delta: 2 - (await onHand()),
        p_movement_type: 'quick_stock_in',
        p_reason: null,
        p_inbound_unit_cost: 300,
        p_used_tyre_unit_id: null,
        p_source_type: null,
        p_source_id: null,
      });
    }
  });

  it('reconciles the balance to the sum of all posted movements', async () => {
    const { data: movements } = await t.service
      .from('inventory_movements')
      .select('quantity_delta')
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId)
      .returns<{ quantity_delta: number }[]>();
    const summed = (movements ?? []).reduce((acc, m) => acc + m.quantity_delta, 0);
    expect(await onHand()).toBe(summed);
  });
});
