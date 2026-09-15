import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[product creation] skipped: missing ${gap.join(', ')}\n`);
}

suite('product creation', () => {
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

  it('creates a truck tyre with only name and retail price', async () => {
    const { data, error } = await t.admin.rpc('create_product_with_prices', {
      p_name: 'Minimal entry truck tyre',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 399,
      p_wholesale_price_incl_gst: null,
    });

    expect(error).toBeNull();
    expect(data).toEqual(expect.any(String));

    const product = await t.admin
      .from('products')
      .select('name, category_code, retail_price_incl_gst, wholesale_price_incl_gst, tyre_condition, tyre_brand_id, tyre_size_id')
      .eq('id', data as string)
      .single();

    expect(product.error).toBeNull();
    expect(product.data).toMatchObject({
      name: 'Minimal entry truck tyre',
      category_code: 'truck_tyre',
      retail_price_incl_gst: 399,
      wholesale_price_incl_gst: null,
      tyre_condition: null,
      tyre_brand_id: null,
      tyre_size_id: null,
    });
  });
});
