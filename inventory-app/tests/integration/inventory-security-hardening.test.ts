import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[inventory security] skipped: missing ${gap.join(', ')}\n`);
}

suite('cost boundaries and branch-safe idempotency', () => {
  let t: TestTenants;
  let standardProductId: string;
  let usedProductId: string;

  async function movement(
    client: TestTenants['lon'],
    locationId: string,
    productId: string,
    requestId = randomUUID(),
  ) {
    return client.rpc('post_inventory_movement', {
      p_request_id: requestId,
      p_product_id: productId,
      p_location_id: locationId,
      p_quantity_delta: 2,
      p_movement_type: 'quick_stock_in',
      p_reason: null,
      p_inbound_unit_cost: 125,
      p_used_tyre_unit_id: null,
      p_source_type: 'security_test',
      p_source_id: null,
      p_supplier_name: 'Security supplier',
    });
  }

  async function createProduct(name: string, condition: 'new' | 'used') {
    const { data, error } = await t.admin.rpc('create_product', {
      p_name: name,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 500,
      p_tyre_condition: condition,
      p_tyre_brand: 'Security tyre',
      p_tyre_size: '11R22.5',
    });
    if (error) throw error;
    return data as string;
  }

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.stock_in', 'inventory.adjust', 'reports.view_inventory_value'],
      regPermissions: ['inventory.view', 'inventory.stock_in', 'inventory.adjust'],
    });
    standardProductId = await createProduct('Security new tyre 11R22.5', 'new');
    usedProductId = await createProduct('Security used tyre 11R22.5', 'used');
    const seeded = await movement(t.admin, t.lonLocationId, standardProductId);
    if (seeded.error) throw seeded.error;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('denies a no-cost Manager every exposed cost-bearing base relation and interface while retaining non-cost reads', async () => {
    const balance = await t.lon
      .from('inventory_balances')
      .select('on_hand, reserved')
      .eq('product_id', standardProductId)
      .eq('location_id', t.lonLocationId);
    expect(balance.error).toBeNull();
    expect(balance.data?.[0]).toMatchObject({ on_hand: 2, reserved: 0 });

    const movementRows = await t.lon
      .from('inventory_movements')
      .select('quantity_delta, supplier_name')
      .eq('product_id', standardProductId);
    expect(movementRows.error).toBeNull();
    expect(movementRows.data?.[0]).toMatchObject({ quantity_delta: 2, supplier_name: 'Security supplier' });

    for (const relation of [
      t.lon.from('inventory_balances').select('weighted_average_cost'),
      t.lon.from('inventory_movements').select('inbound_unit_cost, cost_snapshot'),
      t.lon.from('used_tyre_units').select('cost_basis, selling_price_override'),
    ]) {
      const result = await relation;
      expect(result.error).not.toBeNull();
    }

    const summary = await t.lon
      .from('inventory_product_summary')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', standardProductId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(summary.error).toBeNull();
    expect(summary.data).toEqual({ on_hand: 2, weighted_average_cost: null });

    const auditMetadata = await t.lon
      .from('audit_events')
      .select('event_type, entity_type')
      .eq('entity_type', 'inventory_movement');
    expect(auditMetadata.error).toBeNull();
    expect(auditMetadata.data?.[0]).toMatchObject({ entity_type: 'inventory_movement' });

    const auditDetails = await t.lon.from('audit_events').select('details');
    expect(auditDetails.error).not.toBeNull();

    const value = await t.lon.rpc('inventory_value_for_scope', { p_location_code: 'LON' });
    expect(value.error?.message).toContain('ACCESS_DENIED');
  });

  it('withholds WAC from all stock mutation RPCs without inventory.view_cost', async () => {
    const post = await movement(t.lon, t.lonLocationId, standardProductId);
    expect(Array.isArray(post.data) ? post.data[0]?.weighted_average_cost : post.data?.weighted_average_cost).toBeNull();

    const count = await t.lon.rpc('set_inventory_count', {
      p_request_id: randomUUID(), p_product_id: standardProductId, p_location_id: t.lonLocationId,
      p_counted_quantity: 5, p_reason: 'Security count', p_notes: null,
    });
    expect(Array.isArray(count.data) ? count.data[0]?.weighted_average_cost : count.data?.weighted_average_cost).toBeNull();

    const unit = await t.lon.rpc('create_used_tyre_unit_with_stock', {
      p_request_id: randomUUID(), p_product_id: usedProductId, p_location_id: t.lonLocationId,
      p_tread_depth_mm: 8, p_condition: 'good', p_cost_basis: 90,
      p_selling_price_override: 150, p_notes: null,
    });
    expect(unit.error).toBeNull();
    expect(Array.isArray(unit.data) ? unit.data[0]?.weighted_average_cost : unit.data?.weighted_average_cost).toBeNull();
  });

  it('allows approved cost access through the cost-gated summary and valuation RPC', async () => {
    const { error } = await t.service.from('manager_permissions').insert([
      { user_id: t.lonUser.id, permission_key: 'inventory.view_cost', enabled: true },
    ]);
    if (error) throw error;

    const summary = await t.lon
      .from('inventory_product_summary')
      .select('weighted_average_cost')
      .eq('product_id', standardProductId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(Number(summary.data?.weighted_average_cost)).toBe(125);

    const value = await t.lon.rpc('inventory_value_for_scope', { p_location_code: 'LON' });
    expect(value.error).toBeNull();
    expect(Number(value.data)).toBeGreaterThan(0);

    const admin = await t.admin
      .from('inventory_product_summary')
      .select('weighted_average_cost')
      .eq('product_id', standardProductId)
      .eq('location_id', t.lonLocationId)
      .single();
    expect(Number(admin.data?.weighted_average_cost)).toBe(125);
  });

  it('keeps replay keys actor-and-branch scoped in both LON-to-REG directions', async () => {
    const regKey = randomUUID();
    const regOriginal = await movement(t.reg, t.regLocationId, standardProductId, regKey);
    const lonReplay = await movement(t.lon, t.lonLocationId, standardProductId, regKey);
    expect(regOriginal.error).toBeNull();
    expect(lonReplay.error).toBeNull();
    expect(Array.isArray(lonReplay.data) ? lonReplay.data[0]?.movement_id : lonReplay.data?.movement_id)
      .not.toBe(Array.isArray(regOriginal.data) ? regOriginal.data[0]?.movement_id : regOriginal.data?.movement_id);

    const lonKey = randomUUID();
    const lonOriginal = await movement(t.lon, t.lonLocationId, standardProductId, lonKey);
    const regReplay = await movement(t.reg, t.regLocationId, standardProductId, lonKey);
    expect(lonOriginal.error).toBeNull();
    expect(regReplay.error).toBeNull();
    expect(Array.isArray(regReplay.data) ? regReplay.data[0]?.movement_id : regReplay.data?.movement_id)
      .not.toBe(Array.isArray(lonOriginal.data) ? lonOriginal.data[0]?.movement_id : lonOriginal.data?.movement_id);
  });

  it('keeps count and used-unit replay keys branch-safe too', async () => {
    const regCountKey = randomUUID();
    const regCount = await t.reg.rpc('set_inventory_count', {
      p_request_id: regCountKey, p_product_id: standardProductId, p_location_id: t.regLocationId,
      p_counted_quantity: 7, p_reason: 'REG count', p_notes: null,
    });
    const lonCount = await t.lon.rpc('set_inventory_count', {
      p_request_id: regCountKey, p_product_id: standardProductId, p_location_id: t.lonLocationId,
      p_counted_quantity: 99, p_reason: 'LON count', p_notes: null,
    });
    expect(regCount.error).toBeNull();
    expect(lonCount.error).toBeNull();
    expect(Array.isArray(lonCount.data) ? lonCount.data[0]?.movement_id : lonCount.data?.movement_id)
      .not.toBe(Array.isArray(regCount.data) ? regCount.data[0]?.movement_id : regCount.data?.movement_id);

    const lonUnitKey = randomUUID();
    const lonUnit = await t.lon.rpc('create_used_tyre_unit_with_stock', {
      p_request_id: lonUnitKey, p_product_id: usedProductId, p_location_id: t.lonLocationId,
      p_tread_depth_mm: 7, p_condition: 'fair', p_cost_basis: 70,
      p_selling_price_override: null, p_notes: null,
    });
    const regUnit = await t.reg.rpc('create_used_tyre_unit_with_stock', {
      p_request_id: lonUnitKey, p_product_id: usedProductId, p_location_id: t.regLocationId,
      p_tread_depth_mm: 7, p_condition: 'fair', p_cost_basis: 70,
      p_selling_price_override: null, p_notes: null,
    });
    expect(lonUnit.error).toBeNull();
    expect(regUnit.error).toBeNull();
    expect(Array.isArray(regUnit.data) ? regUnit.data[0]?.unit_id : regUnit.data?.unit_id)
      .not.toBe(Array.isArray(lonUnit.data) ? lonUnit.data[0]?.unit_id : lonUnit.data?.unit_id);
  });
});
