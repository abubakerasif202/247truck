import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { createProduct } from '../../lib/products/repository';
import { ProductInputSchema } from '../../lib/products/validation';

describe('createProduct', () => {
  it('uses the retail/wholesale pricing RPC contract', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: '00000000-0000-4000-8000-000000000001',
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    const input = ProductInputSchema.parse({
      name: 'Valve cap',
      category: 'valve',
      retailPriceInclGst: 3.5,
      wholesalePriceInclGst: 2.5,
    });

    const result = await createProduct(client, input);

    expect(result).toEqual({ id: '00000000-0000-4000-8000-000000000001' });
    expect(rpc).toHaveBeenCalledWith('create_product_with_prices', {
      p_name: 'Valve cap',
      p_category_code: 'valve',
      p_retail_price_incl_gst: 3.5,
      p_wholesale_price_incl_gst: 2.5,
      p_part_reference: null,
      p_notes: null,
      p_tyre_condition: null,
      p_tyre_brand: null,
      p_tyre_pattern: null,
      p_tyre_size: null,
      p_load_index: null,
      p_speed_rating: null,
    });
  });
});
