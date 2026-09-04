import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[opening stock import] skipped: missing ${gap.join(', ')}\n`);
}

suite('opening stock import row boundary', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'inventory.stock_in'],
      regPermissions: ['inventory.view', 'inventory.stock_in'],
    });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('creates one product, posts once, and replays without duplicate stock', async () => {
    const datasetKey = `test-opening:${randomUUID()}`;
    const requestId = randomUUID();
    const rowKey = 'IMPORT BRAND|IP1|315/80R22.5|NEW';
    const args = {
      p_dataset_key: datasetKey,
      p_row_key: rowKey,
      p_row_number: 2,
      p_request_id: requestId,
      p_brand: 'Import Brand',
      p_pattern: 'IP1',
      p_size: '315/80R22.5',
      p_quantity: 5,
      p_location_code: 'REG',
    };

    const first = await t.admin.rpc('import_opening_stock_row', args);
    expect(first.error).toBeNull();
    const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
    expect(firstRow).toMatchObject({ created_product: true, replayed: false });
    expect(firstRow?.product_id).toBeTruthy();
    expect(firstRow?.movement_id).toBeTruthy();

    const second = await t.admin.rpc('import_opening_stock_row', args);
    expect(second.error).toBeNull();
    const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
    expect(secondRow).toMatchObject({
      product_id: firstRow!.product_id,
      movement_id: firstRow!.movement_id,
      created_product: true,
      replayed: true,
    });

    const { data: balance } = await t.service
      .from('inventory_balances')
      .select('on_hand, weighted_average_cost')
      .eq('product_id', firstRow!.product_id)
      .eq('location_id', t.regLocationId)
      .single();
    expect(balance?.on_hand).toBe(5);
    expect(balance?.weighted_average_cost).toBeNull();

    const { count } = await t.service
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', firstRow!.product_id)
      .eq('movement_type', 'opening_stock');
    expect(count).toBe(1);

    const { data: evidence } = await t.service
      .from('opening_stock_import_rows')
      .select('dataset_key, row_key, product_id, inventory_movement_id, created_product')
      .eq('dataset_key', datasetKey)
      .eq('row_key', rowKey)
      .single();
    expect(evidence).toEqual({
      dataset_key: datasetKey,
      row_key: rowKey,
      product_id: firstRow!.product_id,
      inventory_movement_id: firstRow!.movement_id,
      created_product: true,
    });
  });

  it('requires Regency Park and denies Managers', async () => {
    const base = {
      p_dataset_key: `test-opening:${randomUUID()}`,
      p_row_key: `BRANCH-${randomUUID()}`,
      p_row_number: 3,
      p_request_id: randomUUID(),
      p_brand: 'Branch Guard',
      p_pattern: 'BG1',
      p_size: '11R22.5',
      p_quantity: 2,
    };

    const wrongBranch = await t.admin.rpc('import_opening_stock_row', {
      ...base,
      p_location_code: 'LON',
    });
    expect(wrongBranch.error?.message).toContain('OPENING_IMPORT_REGENCY_ONLY');

    const manager = await t.reg.rpc('import_opening_stock_row', {
      ...base,
      p_dataset_key: `manager:${randomUUID()}`,
      p_row_key: `MANAGER-${randomUUID()}`,
      p_request_id: randomUUID(),
      p_location_code: 'REG',
    });
    expect(manager.error?.message).toContain('ACCESS_DENIED');
  });

  it('matches exactly one existing product instead of creating a duplicate', async () => {
    const brand = `Existing ${randomUUID().slice(0, 8)}`;
    const { data: existing, error: createError } = await t.admin.rpc('create_product', {
      p_name: `${brand} EX1 295/80R22.5`,
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: null,
      p_tyre_condition: 'new',
      p_tyre_brand: brand,
      p_tyre_pattern: 'EX1',
      p_tyre_size: '295/80R22.5',
    });
    if (createError || !existing) throw createError ?? new Error('existing product create failed');

    const result = await t.admin.rpc('import_opening_stock_row', {
      p_dataset_key: `match:${randomUUID()}`,
      p_row_key: `${brand.toUpperCase()}|EX1|295/80R22.5|NEW`,
      p_row_number: 4,
      p_request_id: randomUUID(),
      p_brand: brand,
      p_pattern: 'EX1',
      p_size: '295/80r22.5',
      p_quantity: 3,
      p_location_code: 'REG',
    });
    expect(result.error).toBeNull();
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    expect(row).toMatchObject({
      product_id: existing,
      created_product: false,
      replayed: false,
    });
  });

  it('fails closed when the product master has an ambiguous tyre identity', async () => {
    const brand = `Ambiguous ${randomUUID().slice(0, 8)}`;
    for (const suffix of ['A', 'B']) {
      const created = await t.admin.rpc('create_product', {
        p_name: `${brand} AM1 385/65R22.5 ${suffix}`,
        p_category_code: 'truck_tyre',
        p_selling_price_incl_gst: null,
        p_tyre_condition: 'new',
        p_tyre_brand: brand,
        p_tyre_pattern: 'AM1',
        p_tyre_size: '385/65R22.5',
      });
      if (created.error) throw created.error;
    }

    const result = await t.admin.rpc('import_opening_stock_row', {
      p_dataset_key: `ambiguous:${randomUUID()}`,
      p_row_key: `${brand.toUpperCase()}|AM1|385/65R22.5|NEW`,
      p_row_number: 5,
      p_request_id: randomUUID(),
      p_brand: brand,
      p_pattern: 'AM1',
      p_size: '385/65R22.5',
      p_quantity: 1,
      p_location_code: 'REG',
    });
    expect(result.error?.message).toContain('AMBIGUOUS_PRODUCT_MATCH');
  });
});
