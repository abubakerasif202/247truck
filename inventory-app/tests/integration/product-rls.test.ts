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
