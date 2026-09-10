import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[owner-price-batches] skipped: missing ${missing.join(', ')}`);

const SOURCE_SHA256 = 'F7F9EDE7F19AD5AC41884D91B792911078C1BD622BFBF100D387F0650C2FAD8A';
const SCHEDULE = [
  ['Ralson', 'RDR75', '265/70R19.5', '8', 8, 390], ['Ralson', 'RMR61', '265/70R19.5', '7', 7, 380],
  ['Ralson', 'RMR61', '295/80R22.5', '51', 51, 450], ['Ralson', 'RAC55', '295/80R22.5', '38', 38, 525],
  ['Ralson', 'RDR75', '295/80R22.5', '16', 16, 550], ['Ralson', 'RMR61', '385/65R22.5', '16', 16, 690],
  ['Ralson', 'RTR71', '11R22.5', '17', 17, 330], ['Ralson', 'RDR52', '11R22.5', '16', 16, 380],
  ['Ralson', 'RDR55', '11R22.5', '36', 36, 385], ['Ralson', 'RDC66', '11R22.5', '16', 16, 430],
  ['Ralson', 'RAC55', '11R22.5', '22', 22, 395], ['Ralson', 'RDR75', '235/75R17.5', '16', 16, 290],
  ['Ralson', 'RMR61', '235/75R17.5', '16', 16, 299], ['Ralson', 'RMR61', '275/70R22.5', '3', 3, 450],
  ['Greforce', 'HD02', '11R22.5', '8', 8, 385], ['Greforce', 'GR881W', '11R22.5', '107', 107, 220],
  ['Greforce', 'G-ARMOR', '11R22.5', '74', 74, 230], ['Greforce', 'GRD1919', '11R22.5', '37', 37, 350],
  ['Greforce', 'G-PILOT', '295/80R22.5', '37', 37, 399], ['Greforce', 'GRT33', '9.5R17.5', '09', 9, 185],
  ['Greforce', 'GRT33', '235/75R17.5', '13', 13, 180], ['Jumbo', 'SS398', '295/80R22.5', '18', 18, 290],
  ['Jumbo', 'SS618', '275/70R22.5', '40', 40, 235], ['Opartner', 'CP989', '265/70R19.5', '7', 7, 220],
  ['Haulmax', 'ATT101', '11R22.5', '6', 6, 385], ['Haulmax', 'ATT101', '275/70R22.5', '5', 5, 340],
  ['Haulmax', 'ATT420', '295/80R22.5', '2', 2, 490], ['Sailun', 'SFR22', '385/65R22.5', '2', 2, 430],
] as const;

run('audited owner price batches', () => {
  let t: TestTenants;
  const products: string[] = [];
  let firstBatch: string;
  let rows: Array<{ id: string; source_row_number: number }>;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['inventory.edit_global_price'] });
    for (let i = 1; i <= 28; i += 1) {
      const [brand, pattern, size, , , target] = SCHEDULE[i - 1];
      const created = await t.admin.rpc('create_product', {
        p_name: `Owner batch fixture ${i}`,
        p_category_code: 'truck_tyre',
        p_part_reference: `OWNER-BATCH-${i}`,
        p_selling_price_incl_gst: i === 3 ? target : null,
        p_tyre_condition: 'new',
        p_tyre_brand: brand,
        p_tyre_pattern: pattern,
        p_tyre_size: size,
      });
      expect(created.error, JSON.stringify(created.error)).toBeNull();
      products.push(created.data as string);
    }
  });

  afterAll(async () => {
    if (!t) return;
    const cleanup = await t.service
      .from('products')
      .update({ active: false, tyre_condition: 'used' })
      .in('id', products);
    expect(cleanup.error, JSON.stringify(cleanup.error)).toBeNull();
    await Promise.allSettled([t.admin.auth.signOut(), t.lon.auth.signOut(), t.reg.auth.signOut()]);
  });

  async function productSnapshot(id: string) {
    const result = await t.service.from('products').select('id,selling_price_incl_gst,updated_at').eq('id', id).single();
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    return result.data!;
  }

  async function makeRows() {
    const result = [];
    for (let i = 1; i <= 28; i += 1) {
      const [brand, pattern, size, sourceQuantityText, quantity, target] = SCHEDULE[i - 1];
      const product = await productSnapshot(products[i - 1]);
      result.push({
        source_row_number: i,
        product_id: product.id,
        expected_sku: `OWNER-BATCH-${i}`,
        expected_brand: brand,
        expected_pattern: pattern,
        expected_size: size,
        expected_current_price: product.selling_price_incl_gst,
        expected_updated_at: product.updated_at,
        target_price: target,
        reference_quantity: quantity,
        source_quantity_text: sourceQuantityText,
      });
    }
    return result;
  }

  it('creates an exact approved batch and applies rows once without inventory effects', async () => {
    const beforeMovements = (await t.service.from('inventory_movements').select('id', { count: 'exact', head: true })).count;
    const beforeBalances = await t.service.from('inventory_balances').select('product_id,on_hand,reserved,weighted_average_cost').in('product_id', products);
    const created = await t.admin.rpc('create_owner_price_batch', {
      p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: await makeRows(),
    });
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    firstBatch = created.data as string;

    const listed = await t.service.from('pricing_batch_rows').select('id,source_row_number').eq('batch_id', firstBatch).order('source_row_number');
    expect(listed.error, JSON.stringify(listed.error)).toBeNull();
    expect(listed.data).toHaveLength(28);
    rows = listed.data!;

    const applied = await t.admin.rpc('apply_owner_price_batch_row', { p_batch_row_id: rows[0].id });
    expect(applied.error, JSON.stringify(applied.error)).toBeNull();
    expect(applied.data.status).toBe('applied');
    const replay = await t.admin.rpc('apply_owner_price_batch_row', { p_batch_row_id: rows[0].id });
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(applied.data);

    const already = await t.admin.rpc('apply_owner_price_batch_row', { p_batch_row_id: rows[2].id });
    expect(already.error).toBeNull();
    expect(already.data.status).toBe('already_applied');

    const changed = await t.admin.rpc('set_product_selling_price', { p_product_id: products[1], p_selling_price_incl_gst: 999 });
    expect(changed.error).toBeNull();
    const stale = await t.admin.rpc('apply_owner_price_batch_row', { p_batch_row_id: rows[1].id });
    expect(stale.error).toBeNull();
    expect(stale.data.status).toBe('stale');

    const deactivated = await t.service.from('products').update({ active: false }).eq('id', products[3]);
    expect(deactivated.error).toBeNull();
    const identity = await t.admin.rpc('apply_owner_price_batch_row', { p_batch_row_id: rows[3].id });
    expect(identity.error).toBeNull();
    expect(identity.data.status).toBe('identity_mismatch');
    const restored = await t.service.from('products').update({ active: true }).eq('id', products[3]);
    expect(restored.error).toBeNull();

    const afterMovements = (await t.service.from('inventory_movements').select('id', { count: 'exact', head: true })).count;
    const afterBalances = await t.service.from('inventory_balances').select('product_id,on_hand,reserved,weighted_average_cost').in('product_id', products);
    expect(afterMovements).toBe(beforeMovements);
    expect(afterBalances.data).toEqual(beforeBalances.data);
    expect((await t.service.from('pricing_batch_row_events').select('id').eq('batch_row_id', rows[0].id)).data).toHaveLength(1);
  });

  it('fails closed for unauthorized callers and preserves append-only records', async () => {
    const denied = await t.reg.rpc('create_owner_price_batch', {
      p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: await makeRows(),
    });
    expect(denied.error?.message).toBe('ACCESS_DENIED');

    const mutation = await t.service.from('pricing_batches').update({ reference_quantity: 1 }).eq('id', firstBatch);
    expect(mutation.error).not.toBeNull();
    expect((await t.service.from('pricing_batch_row_events').select('id').eq('batch_row_id', rows[0].id)).data).toHaveLength(1);
  });

  it('rejects invalid source, duplicate source rows, ambiguous identities and over-precise money', async () => {
    const validRows = await makeRows();
    const invalidSource = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: '0'.repeat(64), p_source_row_count: 28, p_reference_quantity: 643, p_rows: validRows });
    expect(invalidSource.error?.message).toBe('PRICING_SOURCE_INVALID');
    const duplicate = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: [{ ...validRows[1], source_row_number: 2 }, ...validRows.slice(1)] });
    expect(duplicate.error?.message).toBe('PRICING_ROW_INVALID');
    const tamperedTarget = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: validRows.map((row, i) => i === 0 ? { ...row, target_price: 391 } : row) });
    expect(tamperedTarget.error?.message).toBe('PRICING_SOURCE_ROW_MISMATCH');
    const duplicateProduct = await t.admin.rpc('create_product', {
      p_name: 'Ambiguous owner batch fixture', p_category_code: 'truck_tyre', p_part_reference: 'OWNER-BATCH-1',
      p_selling_price_incl_gst: null, p_tyre_condition: 'new', p_tyre_brand: 'Ralson',
      p_tyre_pattern: 'RDR75', p_tyre_size: '265/70R19.5',
    });
    expect(duplicateProduct.error).toBeNull();
    products.push(duplicateProduct.data as string);
    const ambiguous = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: validRows });
    expect(ambiguous.error?.message).toBe('PRICING_IDENTITY_AMBIGUOUS');
    const precise = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: validRows.map((row, i) => i === 0 ? { ...row, target_price: 201.001 } : row) });
    expect(precise.error?.message).toBe('PRICING_ROW_INVALID');
  });
});
