import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;

if (gap.length > 0) {
  process.stderr.write(
    `[product RLS] skipped: missing ${gap.join(', ')}; use a disposable/local Supabase project only.\n`,
  );
}

suite('product catalogue RLS', () => {
  let t: TestTenants;
  let productId: string;
  let lonUnitId: string;
  let regUnitId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view'],
      regPermissions: ['inventory.view'],
    });

    const { data: product, error } = await t.admin.rpc('create_product', {
      p_name: 'Bridgestone R150 11R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 540,
      p_tyre_condition: 'used',
      p_tyre_brand: 'Bridgestone',
      p_tyre_size: '11R22.5',
    });
    if (error || !product) throw error ?? new Error('seed product failed');
    productId = product as string;

    const units = await t.service
      .from('used_tyre_units')
      .insert([
        {
          product_id: productId,
          location_id: t.lonLocationId,
          internal_unit_code: `UT-LON-${productId.slice(0, 6)}`,
          tread_depth_mm: 9,
          condition: 'good',
          cost_basis: 120,
          status: 'available',
        },
        {
          product_id: productId,
          location_id: t.regLocationId,
          internal_unit_code: `UT-REG-${productId.slice(0, 6)}`,
          tread_depth_mm: 7,
          condition: 'fair',
          cost_basis: 90,
          status: 'available',
        },
      ])
      .select('id, location_id')
      .returns<{ id: string; location_id: string }[]>();
    if (units.error || !units.data) throw units.error ?? new Error('seed units failed');
    lonUnitId = units.data.find((u) => u.location_id === t.lonLocationId)!.id;
    regUnitId = units.data.find((u) => u.location_id === t.regLocationId)!.id;
  });

  // Products that have inventory balances / movements cannot be hard-deleted
  // (soft-delete semantics). Reset the local DB before the integration suite.
  afterAll(async () => {
    await t?.cleanup();
  });

  it('seeds inventory_settings for both locations on product insert', async () => {
    const { data } = await t.service
      .from('inventory_settings')
      .select('location_id')
      .eq('product_id', productId);
    expect(new Set((data ?? []).map((r) => r.location_id))).toEqual(
      new Set([t.lonLocationId, t.regLocationId]),
    );
  });

  it('lets both Managers read the global product master', async () => {
    const [lon, reg] = await Promise.all([
      t.lon.from('products').select('id').eq('id', productId),
      t.reg.from('products').select('id').eq('id', productId),
    ]);
    expect(lon.data).toEqual([{ id: productId }]);
    expect(reg.data).toEqual([{ id: productId }]);
  });

  it('scopes used-tyre units to the Manager branch', async () => {
    const lonUnits = await t.lon
      .from('used_tyre_units')
      .select('id, location_id')
      .eq('product_id', productId);
    expect(lonUnits.data?.map((u) => u.id)).toEqual([lonUnitId]);

    const regView = await t.reg
      .from('used_tyre_units')
      .select('id')
      .eq('id', lonUnitId);
    expect(regView.data).toEqual([]);
  });

  it('lets an Admin see both branches of used-tyre units', async () => {
    const { data } = await t.admin
      .from('used_tyre_units')
      .select('id')
      .eq('product_id', productId);
    expect(new Set(data?.map((u) => u.id))).toEqual(new Set([lonUnitId, regUnitId]));
  });

  it('blocks direct product INSERT for every authenticated role', async () => {
    for (const client of [t.lon, t.admin]) {
      const result = await client.from('products').insert({
        name: 'Rogue product',
        category_code: 'other_part',
        selling_price_incl_gst: 10,
        created_by: t.lonUser.id,
      });
      expect(result.error).not.toBeNull();
    }
  });

  it('lets an Admin create a product through create_product but rejects a Manager', async () => {
    const managerAttempt = await t.lon.rpc('create_product', {
      p_name: 'Manager rogue tube',
      p_category_code: 'tube',
      p_selling_price_incl_gst: 25,
    });
    expect(managerAttempt.error?.message).toContain('ACCESS_DENIED');

    const adminCreate = await t.admin.rpc('create_product', {
      p_name: 'Valve cap pack',
      p_category_code: 'valve',
      p_selling_price_incl_gst: 3.5,
    });
    expect(adminCreate.error).toBeNull();
    const newId = adminCreate.data as string;

    const { data: settings } = await t.service
      .from('inventory_settings')
      .select('location_id')
      .eq('product_id', newId);
    expect(settings).toHaveLength(2);

    const { data: audit } = await t.service
      .from('audit_events')
      .select('event_type, actor_user_id')
      .eq('entity_id', newId)
      .eq('event_type', 'PRODUCT_CREATED');
    expect(audit).toEqual([
      { event_type: 'PRODUCT_CREATED', actor_user_id: t.adminUser.id },
    ]);
  });

  it('creates a minimal workspace product with zero stock and isolates it from the other manager', async () => {
    const created = await t.admin.rpc('create_workspace_product', { p_location_id: t.lonLocationId, p_name: 'Test Product', p_retail_price_incl_gst: 100 });
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    const id = created.data as string;
    const product = await t.service.from('products').select('name,category_code,retail_price_incl_gst,wholesale_price_incl_gst,owner_location_id,tyre_brand_id,tyre_pattern_id,tyre_size_id,load_index,speed_rating,notes').eq('id', id).single();
    expect(product.data).toMatchObject({ name: 'Test Product', category_code: null, retail_price_incl_gst: 100, wholesale_price_incl_gst: null, owner_location_id: t.lonLocationId, tyre_brand_id: null, tyre_pattern_id: null, tyre_size_id: null, load_index: null, speed_rating: null, notes: null });
    const balances = await t.service.from('inventory_balances').select('location_id,on_hand,reserved,weighted_average_cost').eq('product_id',id);
    expect(balances.data).toEqual([{ location_id: t.lonLocationId, on_hand: 0, reserved: 0, weighted_average_cost: 0 }]);
    expect((await t.lon.from('products').select('id').eq('id',id)).data).toEqual([{ id }]);
    expect((await t.reg.from('products').select('id').eq('id',id)).data).toEqual([]);
  });

  it('accepts optional product combinations and rejects missing required values and manager cross-workspace creation', async () => {
    for (const input of [
      { p_name: 'Brand only', p_retail_price_incl_gst: 10, p_tyre_condition: 'new', p_tyre_brand: 'Optional Brand' },
      { p_name: 'Complete tyre', p_retail_price_incl_gst: 230, p_category_code: 'truck_tyre', p_wholesale_price_incl_gst: 200, p_tyre_condition: 'new', p_tyre_brand: 'Complete Brand', p_tyre_pattern: 'Pattern', p_tyre_size: '11R22.5', p_load_index: '148', p_speed_rating: 'M', p_notes: 'Complete fixture' },
      { p_name: 'Zero price', p_retail_price_incl_gst: 0 },
    ]) expect((await t.admin.rpc('create_workspace_product', { p_location_id: t.regLocationId, ...input })).error).toBeNull();
    expect((await t.admin.rpc('create_workspace_product', { p_location_id: t.regLocationId, p_name: '', p_retail_price_incl_gst: 100 })).error?.message).toBe('PRODUCT_NAME_REQUIRED');
    expect((await t.admin.rpc('create_workspace_product', { p_location_id: t.regLocationId, p_name: 'No price', p_retail_price_incl_gst: null })).error?.message).toBe('RETAIL_PRICE_REQUIRED');
    expect((await t.lon.rpc('create_workspace_product', { p_location_id: t.regLocationId, p_name: 'Cross tenant', p_retail_price_incl_gst: 100 })).error?.message).toBe('ACCESS_DENIED');
  });

  it('stores pending selling price as NULL and explicit zero as zero', async () => {
    const pending = await t.admin.rpc('create_product', {
      p_name: 'Pending price tube',
      p_category_code: 'tube',
      p_selling_price_incl_gst: null,
    });
    expect(pending.error).toBeNull();

    const zero = await t.admin.rpc('create_product', {
      p_name: 'Explicit zero valve',
      p_category_code: 'valve',
      p_selling_price_incl_gst: 0,
    });
    expect(zero.error).toBeNull();

    const { data } = await t.service
      .from('products')
      .select('id, selling_price_incl_gst')
      .in('id', [pending.data as string, zero.data as string]);

    const pendingRow = data?.find((row) => row.id === pending.data);
    const zeroRow = data?.find((row) => row.id === zero.data);
    expect(pendingRow?.selling_price_incl_gst).toBeNull();
    expect(Number(zeroRow?.selling_price_incl_gst)).toBe(0);

    const managerAttempt = await t.lon.rpc('create_product', {
      p_name: 'Manager pending rogue',
      p_category_code: 'tube',
      p_selling_price_incl_gst: null,
    });
    expect(managerAttempt.error?.message).toContain('ACCESS_DENIED');
  });

  it('forbids direct authenticated used-tyre-unit inserts (Task 6 owns this path)', async () => {
    const result = await t.admin.from('used_tyre_units').insert({
      product_id: productId,
      location_id: t.lonLocationId,
      internal_unit_code: `UT-ROGUE-${productId.slice(0, 6)}`,
      tread_depth_mm: 5,
      condition: 'good',
      cost_basis: 50,
      status: 'available',
    });
    expect(result.error).not.toBeNull();
  });
});
