import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadOpeningStockSource } from '../../lib/opening-stock/source';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[opening stock dataset] skipped: missing ${gap.join(', ')}\n`);
}

suite('fixed 53-line Regency Park opening stock dataset', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view'],
      regPermissions: ['inventory.view'],
    });
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('posts exactly 725 New tyres to Regency Park once and replays safely', async () => {
    const source = await loadOpeningStockSource();
    expect(source.rows).toHaveLength(53);
    expect(source.totalQuantity).toBe(725);

    const productIds = new Set<string>();
    let postedQuantity = 0;

    for (const row of source.rows) {
      const result = await t.admin.rpc('import_opening_stock_row', {
        p_dataset_key: source.datasetKey,
        p_row_key: row.rowKey,
        p_row_number: row.rowNumber,
        p_request_id: row.requestId,
        p_brand: row.brand,
        p_pattern: row.pattern,
        p_size: row.size,
        p_quantity: row.quantity,
        p_location_code: row.location,
      });
      expect(result.error, `row ${row.rowNumber}: ${result.error?.message ?? ''}`).toBeNull();
      const imported = Array.isArray(result.data) ? result.data[0] : result.data;
      expect(imported?.replayed).toBe(false);
      expect(imported?.product_id).toBeTruthy();
      productIds.add(imported!.product_id);
      postedQuantity += row.quantity;
    }

    expect(productIds.size).toBe(53);
    expect(postedQuantity).toBe(725);

    const ids = [...productIds];
    const { data: regBalances, error: regError } = await t.service
      .from('inventory_balances')
      .select('product_id, on_hand, weighted_average_cost')
      .eq('location_id', t.regLocationId)
      .in('product_id', ids);
    if (regError) throw regError;

    expect(regBalances).toHaveLength(53);
    expect((regBalances ?? []).reduce((sum, row) => sum + row.on_hand, 0)).toBe(725);
    expect((regBalances ?? []).every((row) => row.weighted_average_cost == null)).toBe(true);

    const { data: lonBalances, error: lonError } = await t.service
      .from('inventory_balances')
      .select('product_id, on_hand')
      .eq('location_id', t.lonLocationId)
      .in('product_id', ids);
    if (lonError) throw lonError;
    expect((lonBalances ?? []).reduce((sum, row) => sum + row.on_hand, 0)).toBe(0);

    const { data: products, error: productsError } = await t.service
      .from('products')
      .select('id, category_code, tyre_condition, selling_price_incl_gst')
      .in('id', ids);
    if (productsError) throw productsError;
    expect(products).toHaveLength(53);
    expect(
      (products ?? []).every(
        (product) =>
          product.category_code === 'truck_tyre' &&
          product.tyre_condition === 'new' &&
          product.selling_price_incl_gst == null,
      ),
    ).toBe(true);

    const { data: evidence, error: evidenceError } = await t.service
      .from('opening_stock_import_rows')
      .select('row_key, inventory_movement_id')
      .eq('dataset_key', source.datasetKey);
    if (evidenceError) throw evidenceError;
    expect(evidence).toHaveLength(53);

    let replayedRows = 0;
    for (const row of source.rows) {
      const replay = await t.admin.rpc('import_opening_stock_row', {
        p_dataset_key: source.datasetKey,
        p_row_key: row.rowKey,
        p_row_number: row.rowNumber,
        p_request_id: row.requestId,
        p_brand: row.brand,
        p_pattern: row.pattern,
        p_size: row.size,
        p_quantity: row.quantity,
        p_location_code: row.location,
      });
      expect(replay.error).toBeNull();
      const imported = Array.isArray(replay.data) ? replay.data[0] : replay.data;
      expect(imported?.replayed).toBe(true);
      replayedRows += 1;
    }
    expect(replayedRows).toBe(53);

    const { data: afterReplay, error: afterReplayError } = await t.service
      .from('inventory_balances')
      .select('on_hand')
      .eq('location_id', t.regLocationId)
      .in('product_id', ids);
    if (afterReplayError) throw afterReplayError;
    expect((afterReplay ?? []).reduce((sum, row) => sum + row.on_hand, 0)).toBe(725);
  }, 120_000);
});
