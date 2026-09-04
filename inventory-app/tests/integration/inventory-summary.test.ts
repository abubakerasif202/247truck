import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[inventory summary] skipped: missing ${gap.join(', ')}\n`);
}

suite('inventory_product_summary + location-specific low stock', () => {
  let t: TestTenants;
  let productId: string;

  async function stockIn(locationId: string, qty: number) {
    const { error } = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(),
      p_product_id: productId,
      p_location_id: locationId,
      p_quantity_delta: qty,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: 100,
      p_used_tyre_unit_id: null,
      p_source_type: null,
      p_source_id: null,
    });
    if (error) throw error;
  }

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view'],
      regPermissions: ['inventory.view'],
    });

    const { data, error } = await t.admin.rpc('create_product', {
      p_name: 'Summary test rim 22.5x9.00',
      p_category_code: 'rim_wheel',
      p_selling_price_incl_gst: 210,
    });
    if (error) throw error;
    productId = data as string;

    await stockIn(t.lonLocationId, 4);
    await stockIn(t.regLocationId, 15);

    for (const code of ['LON', 'REG']) {
      const { error: settingsError } = await t.admin.rpc('set_reorder_settings', {
        p_product_id: productId,
        p_location_code: code,
        p_minimum_stock: 6,
        p_reorder_quantity: 12,
      });
      if (settingsError) throw settingsError;
    }
  });

  afterAll(async () => {
    if (t && productId) {
      await t.service
        .from('inventory_settings')
        .update({ minimum_stock: 0, reorder_quantity: 0, preferred_supplier_id: null })
        .eq('product_id', productId);
    }
    await t?.cleanup();
  });

  it('flags LON low and REG healthy for the same product', async () => {
    const { data } = await t.admin
      .from('inventory_product_summary')
      .select('location_code, available, minimum_stock, low_stock')
      .eq('product_id', productId)
      .order('location_code');

    expect(data).toEqual([
      { location_code: 'LON', available: 4, minimum_stock: 6, low_stock: true },
      { location_code: 'REG', available: 15, minimum_stock: 6, low_stock: false },
    ]);
  });

  it('scopes the summary view to the Manager branch via security_invoker RLS', async () => {
    const lon = await t.lon
      .from('inventory_product_summary')
      .select('location_code, low_stock')
      .eq('product_id', productId);
    expect(lon.data).toEqual([{ location_code: 'LON', low_stock: true }]);

    const reg = await t.reg
      .from('inventory_product_summary')
      .select('location_code, low_stock')
      .eq('product_id', productId);
    expect(reg.data).toEqual([{ location_code: 'REG', low_stock: false }]);
  });

  it('hides weighted_average_cost from a Manager without inventory.view_cost', async () => {
    const lon = await t.lon
      .from('inventory_product_summary')
      .select('location_code, weighted_average_cost')
      .eq('product_id', productId);
    expect(lon.error).toBeNull();
    expect(lon.data).toEqual([
      { location_code: 'LON', weighted_average_cost: null },
    ]);

    const admin = await t.admin
      .from('inventory_product_summary')
      .select('location_code, weighted_average_cost')
      .eq('product_id', productId)
      .eq('location_code', 'LON');
    expect(Number(admin.data?.[0]?.weighted_average_cost)).toBe(100);
  });

  it('reports known value separately from positive stock with unknown WAC', async () => {
    const { data: openingProduct, error: productError } = await t.admin.rpc('create_product', {
      p_name: `Pending valuation tyre ${randomUUID()}`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: null,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Pending Valuation',
      p_tyre_pattern: randomUUID().slice(0, 8),
      p_tyre_size: '295/80R22.5',
    });
    if (productError || !openingProduct) throw productError ?? new Error('product create failed');

    const opening = await t.admin.rpc('post_opening_stock', {
      p_request_id: randomUUID(),
      p_product_id: openingProduct,
      p_location_id: t.regLocationId,
      p_quantity: 12,
      p_inbound_unit_cost: null,
      p_source_type: 'valuation-test',
      p_source_id: randomUUID(),
    });
    expect(opening.error).toBeNull();

    const { data: balances, error: balanceError } = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost, products!inner(active), locations!inner(code)')
      .eq('locations.code', 'REG')
      .eq('products.active', true);
    if (balanceError) throw balanceError;

    const expectedKnown = (balances ?? []).reduce(
      (sum, row) =>
        sum +
        (row.weighted_average_cost == null
          ? 0
          : Number(row.on_hand) * Number(row.weighted_average_cost)),
      0,
    );
    const expectedUnvalued = (balances ?? []).reduce(
      (sum, row) => sum + (row.on_hand > 0 && row.weighted_average_cost == null ? row.on_hand : 0),
      0,
    );

    const valuation = await t.admin.rpc('inventory_valuation_for_scope', {
      p_location_code: 'REG',
    });
    expect(valuation.error).toBeNull();
    const row = Array.isArray(valuation.data) ? valuation.data[0] : valuation.data;
    expect(Number(row?.known_value)).toBeCloseTo(expectedKnown, 4);
    expect(Number(row?.unvalued_units)).toBe(expectedUnvalued);
    expect(expectedUnvalued).toBeGreaterThanOrEqual(12);
  });

  it('rejects valuation for a Manager without the permissions', async () => {
    const denied = await t.lon.rpc('inventory_valuation_for_scope', {
      p_location_code: 'LON',
    });
    expect(denied.error?.message).toContain('ACCESS_DENIED');
  });

  it('retains legacy inventory_value_for_scope denial for compatibility', async () => {
    const denied = await t.lon.rpc('inventory_value_for_scope', {
      p_location_code: 'LON',
    });
    expect(denied.error?.message).toContain('ACCESS_DENIED');
  });

  it('rejects a Manager calling set_reorder_settings', async () => {
    const { error } = await t.lon.rpc('set_reorder_settings', {
      p_product_id: productId,
      p_location_code: 'LON',
      p_minimum_stock: 1,
      p_reorder_quantity: 1,
    });
    expect(error?.message).toContain('ACCESS_DENIED');
  });
});
