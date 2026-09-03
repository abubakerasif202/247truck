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

    // LON: available 4, minimum 6 -> low. REG: available 15, minimum 6 -> healthy.
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
    // Append-only ledger — reset the local DB before the suite. Fixture users
    // own audited rows so t.cleanup() cannot delete them; zero this product's
    // reorder settings (minimum_stock / reorder_quantity are NOT NULL) so it
    // does not surface as a low-stock suggestion in a following e2e run that
    // shares this disposable database without a reset.
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

    // The Admin (who is app_is_admin -> has every permission) still sees it.
    const admin = await t.admin
      .from('inventory_product_summary')
      .select('location_code, weighted_average_cost')
      .eq('product_id', productId)
      .eq('location_code', 'LON');
    expect(Number(admin.data?.[0]?.weighted_average_cost)).toBe(100);
  });

  it('rejects inventory_value_for_scope for a Manager without the permission', async () => {
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
