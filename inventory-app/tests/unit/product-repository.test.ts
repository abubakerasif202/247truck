import { describe, expect, it, vi } from 'vitest';

import { createProduct } from '../../lib/products/repository';
import type { ProductInput } from '../../lib/products/validation';
import type { SupabaseClient } from '@supabase/supabase-js';

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn((_fn: string, _params?: Record<string, unknown>) => Promise.resolve(result));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function input(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'Michelin X Line',
    category: 'truck_tyre',
    partReference: null,
    retailPriceInclGst: 700,
    wholesalePriceInclGst: 630,
    sellingPriceInclGst: null,
    notes: null,
    active: true,
    tyre: undefined,
    ...overrides,
  };
}

describe('createProduct', () => {
  it('calls create_product_with_prices — not the legacy single-price create_product — with both prices', async () => {
    const { client: supabase, rpc } = client({ data: 'new-product-id', error: null });

    const result = await createProduct(supabase, input());

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpc.mock.calls[0];
    // create_product only accepts a single legacy p_selling_price_incl_gst and
    // has no retail/wholesale parameters; calling it with this input's field
    // names fails every time with PGRST202 ("could not find the function").
    expect(fnName).toBe('create_product_with_prices');
    expect(params).toMatchObject({
      p_name: 'Michelin X Line',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 700,
      p_wholesale_price_incl_gst: 630,
    });
    expect(result).toEqual({ id: 'new-product-id' });
  });

  it('falls back to sellingPriceInclGst for legacy callers that never set retailPriceInclGst', async () => {
    const { client: supabase, rpc } = client({ data: 'new-product-id', error: null });

    await createProduct(supabase, input({ retailPriceInclGst: null, sellingPriceInclGst: 500 }));

    const [, params] = rpc.mock.calls[0];
    expect(params?.p_retail_price_incl_gst).toBe(500);
  });

  it('surfaces ACCESS_DENIED as a friendly Admin-only message', async () => {
    const { client: supabase } = client({ data: null, error: { message: 'ACCESS_DENIED' } });

    await expect(createProduct(supabase, input())).rejects.toThrow('Only Admins can create products.');
  });
});
