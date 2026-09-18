import { describe, expect, it, afterAll, beforeAll } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[product-creation] skipped: missing ${missing.join(', ')}`);

/**
 * Regression coverage for `createProduct()` in lib/products/repository.ts,
 * which previously called the `create_product` RPC with `p_retail_price_incl_gst`
 * / `p_wholesale_price_incl_gst` parameters that RPC does not have — every
 * product creation through the admin "Add Product" form failed with PGRST202
 * ("could not find the function"). No prior test exercised this RPC name; the
 * other product-creation test helpers all call the legacy single-price
 * `create_product` RPC directly, not `create_product_with_prices`.
 */
run('product creation via create_product_with_prices', () => {
  let t: TestTenants;
  const createdProductIds: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({});
  });

  afterAll(async () => {
    if (t) {
      await t.service.from('products').delete().in('id', createdProductIds);
      await t.cleanup();
    }
  });

  it('creates a product with both retail and wholesale pricing set', async () => {
    const created = await t.admin.rpc('create_product_with_prices', {
      p_name: 'Regression retail/wholesale tyre',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 700,
      p_wholesale_price_incl_gst: 630,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Regression brand',
      p_tyre_size: '315/80R22.5',
    });
    expect(created.error).toBeNull();
    const productId = created.data as string;
    createdProductIds.push(productId);

    const row = await t.service
      .from('products')
      .select('retail_price_incl_gst,wholesale_price_incl_gst,selling_price_incl_gst')
      .eq('id', productId)
      .single();
    expect(row.error).toBeNull();
    expect(Number(row.data!.retail_price_incl_gst)).toBe(700);
    expect(Number(row.data!.wholesale_price_incl_gst)).toBe(630);
    // The retail-compatibility trigger keeps the legacy column in sync.
    expect(Number(row.data!.selling_price_incl_gst)).toBe(700);
  });

  it('rejects a negative wholesale price without creating the product', async () => {
    const before = await t.service.from('products').select('id', { count: 'exact', head: true });
    const rejected = await t.admin.rpc('create_product_with_prices', {
      p_name: 'Should not be created',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 700,
      p_wholesale_price_incl_gst: -1,
    });
    expect(rejected.error?.message).toContain('INVALID_PRICE');
    const after = await t.service.from('products').select('id', { count: 'exact', head: true });
    expect(after.count).toBe(before.count);
  });

  it('denies non-Admins', async () => {
    const denied = await t.lon.rpc('create_product_with_prices', {
      p_name: 'Manager attempt',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 700,
      p_wholesale_price_incl_gst: 630,
    });
    expect(denied.error?.message).toContain('ACCESS_DENIED');
  });
});
