import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[owner-price-batches] skipped: missing ${missing.join(', ')}`);

const SOURCE_SHA256 = 'F7F9EDE7F19AD5AC41884D91B792911078C1BD622BFBF100D387F0650C2FAD8A';

run('audited owner price batches', () => {
  let t: TestTenants;
  const products: string[] = [];
  let firstBatch: string;
  let rows: Array<{ id: string; source_row_number: number }>;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: ['inventory.edit_global_price'] });
    for (let i = 1; i <= 28; i += 1) {
      const created = await t.admin.rpc('create_product', {
        p_name: `Owner batch fixture ${i}`,
        p_category_code: 'truck_tyre',
        p_part_reference: `OWNER-BATCH-${i}`,
        p_selling_price_incl_gst: i === 3 ? 203 : null,
        p_tyre_condition: 'new',
        p_tyre_brand: `Owner Brand ${i}`,
        p_tyre_pattern: `Owner Pattern ${i}`,
        p_tyre_size: '11R22.5',
      });
      expect(created.error, JSON.stringify(created.error)).toBeNull();
      products.push(created.data as string);
    }
  });

  afterAll(async () => {
    if (t) await Promise.allSettled([t.admin.auth.signOut(), t.lon.auth.signOut(), t.reg.auth.signOut()]);
  });

  async function productSnapshot(id: string) {
    const result = await t.service.from('products').select('id,selling_price_incl_gst,updated_at').eq('id', id).single();
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    return result.data!;
  }

  async function makeRows() {
    const result = [];
    for (let i = 1; i <= 28; i += 1) {
      const product = await productSnapshot(products[i - 1]);
      result.push({
        source_row_number: i,
        product_id: product.id,
        expected_sku: `OWNER-BATCH-${i}`,
        expected_brand: `Owner Brand ${i}`,
        expected_pattern: `Owner Pattern ${i}`,
        expected_size: '11R22.5',
        expected_current_price: product.selling_price_incl_gst,
        expected_updated_at: product.updated_at,
        target_price: i === 3 ? 203 : 200 + i,
        reference_quantity: i === 1 ? 22 : 23,
        approved: true,
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
    const duplicate = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: [{ ...validRows[0], source_row_number: 2 }, ...validRows.slice(1)] });
    expect(duplicate.error?.message).toBe('PRICING_ROW_INVALID');
    const duplicateProduct = await t.admin.rpc('create_product', {
      p_name: 'Ambiguous owner batch fixture', p_category_code: 'truck_tyre', p_part_reference: 'OWNER-BATCH-1',
      p_selling_price_incl_gst: null, p_tyre_condition: 'new', p_tyre_brand: 'Owner Brand 1',
      p_tyre_pattern: 'Owner Pattern 1', p_tyre_size: '11R22.5',
    });
    expect(duplicateProduct.error).toBeNull();
    const ambiguous = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: validRows });
    expect(ambiguous.error?.message).toBe('PRICING_IDENTITY_AMBIGUOUS');
    const precise = await t.admin.rpc('create_owner_price_batch', { p_source_sha256: SOURCE_SHA256, p_source_row_count: 28, p_reference_quantity: 643, p_rows: validRows.map((row, i) => i === 0 ? { ...row, target_price: 201.001 } : row) });
    expect(precise.error?.message).toBe('PRICING_ROW_INVALID');
  });
});
