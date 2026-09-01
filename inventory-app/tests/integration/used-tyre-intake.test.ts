import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[used tyre intake] skipped: missing ${gap.join(', ')}\n`);
}

suite('create_used_tyre_unit_with_stock', () => {
  let t: TestTenants;
  let usedProductId: string;
  let newProductId: string;

  async function createProduct(name: string, condition: 'new' | 'used') {
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: name,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 300,
      p_tyre_condition: condition,
      p_tyre_brand: 'Bridgestone',
      p_tyre_size: '11R22.5',
    });
    if (error) throw error;
    return data as string;
  }

  async function counts(productId: string) {
    const [units, movements, balance] = await Promise.all([
      t.service.from('used_tyre_units').select('id', { count: 'exact', head: true }).eq('product_id', productId),
      t.service.from('inventory_movements').select('id', { count: 'exact', head: true }).eq('product_id', productId),
      t.service
        .from('inventory_balances')
        .select('on_hand')
        .eq('product_id', productId)
        .eq('location_id', t.lonLocationId)
        .single<{ on_hand: number }>(),
    ]);
    return {
      units: units.count ?? 0,
      movements: movements.count ?? 0,
      onHand: balance.data?.on_hand ?? 0,
    };
  }

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.stock_in'],
      regPermissions: ['inventory.stock_in'],
    });
    usedProductId = await createProduct('Used casing 11R22.5', 'used');
    newProductId = await createProduct('New line-haul 11R22.5', 'new');
  });

  // Append-only ledger: see the note in inventory-rpc.test.ts. Reset the local
  // DB before the integration suite.
  afterAll(async () => {
    await t?.cleanup();
  });

  it('creates the unit, a linked +1 movement, and one extra on-hand atomically', async () => {
    const { data, error } = await t.lon.rpc('create_used_tyre_unit_with_stock', {
      p_request_id: randomUUID(),
      p_product_id: usedProductId,
      p_location_id: t.lonLocationId,
      p_tread_depth_mm: 9.5,
      p_condition: 'good',
      p_cost_basis: 140,
      p_selling_price_override: 260,
      p_notes: null,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.unit_code).toMatch(/^UT-\d{6}$/);
    expect(row.on_hand).toBe(1);

    const { data: movement } = await t.service
      .from('inventory_movements')
      .select('quantity_delta, movement_type, used_tyre_unit_id')
      .eq('product_id', usedProductId)
      .single();
    expect(movement).toEqual({
      quantity_delta: 1,
      movement_type: 'used_unit_in',
      used_tyre_unit_id: row.unit_id,
    });

    expect(await counts(usedProductId)).toEqual({ units: 1, movements: 1, onHand: 1 });
  });

  it('rolls back completely when the product is not a used tyre', async () => {
    const before = await counts(newProductId);
    const { error } = await t.lon.rpc('create_used_tyre_unit_with_stock', {
      p_request_id: randomUUID(),
      p_product_id: newProductId,
      p_location_id: t.lonLocationId,
      p_tread_depth_mm: 8,
      p_condition: 'good',
      p_cost_basis: 100,
      p_selling_price_override: null,
      p_notes: null,
    });
    expect(error?.message).toContain('NOT_A_USED_TYRE');
    expect(await counts(newProductId)).toEqual(before);
  });

  it('rejects an unauthorised cross-branch intake without creating anything', async () => {
    const before = await counts(usedProductId);
    const { error } = await t.reg.rpc('create_used_tyre_unit_with_stock', {
      p_request_id: randomUUID(),
      p_product_id: usedProductId,
      p_location_id: t.lonLocationId,
      p_tread_depth_mm: 8,
      p_condition: 'fair',
      p_cost_basis: 80,
      p_selling_price_override: null,
      p_notes: null,
    });
    expect(error?.message).toContain('ACCESS_DENIED');
    expect(await counts(usedProductId)).toEqual(before);
  });
});
