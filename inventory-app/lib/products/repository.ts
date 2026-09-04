import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProductCategoryCode, ProductSummary } from './types';
import type { ProductInput } from './validation';

type ProductRow = {
  id: string;
  name: string;
  category_code: ProductCategoryCode;
  part_reference: string | null;
  selling_price_incl_gst: number | null;
  active: boolean;
  tyre_condition: 'new' | 'used' | null;
  tyre_brands: { display_name: string } | null;
  tyre_patterns: { display_name: string } | null;
  tyre_sizes: { display_size: string } | null;
};

const PRODUCT_SELECT =
  'id, name, category_code, part_reference, selling_price_incl_gst, active, tyre_condition, ' +
  'tyre_brands(display_name), tyre_patterns(display_name), tyre_sizes(display_size)';

function toSummary(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    categoryCode: row.category_code,
    partReference: row.part_reference,
    sellingPriceInclGst:
      row.selling_price_incl_gst == null
        ? null
        : Number(row.selling_price_incl_gst),
    active: row.active,
    tyreCondition: row.tyre_condition,
    brandName: row.tyre_brands?.display_name ?? null,
    patternName: row.tyre_patterns?.display_name ?? null,
    sizeName: row.tyre_sizes?.display_size ?? null,
  };
}

export async function getProduct(
  client: SupabaseClient,
  productId: string,
): Promise<ProductSummary | null> {
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', productId)
    .maybeSingle<ProductRow>();
  if (error) {
    console.error('[products] getProduct failed', error.message);
    throw new Error('Could not load the product.');
  }
  return data ? toSummary(data) : null;
}

/**
 * Creates a product via the `create_product` RPC — a single SECURITY DEFINER
 * transaction that re-checks Admin, upserts normalised tyre lookups with
 * ON CONFLICT, inserts the product (a trigger zero-fills `inventory_settings`
 * for both locations), and writes the `PRODUCT_CREATED` audit row atomically.
 */
export async function createProduct(
  client: SupabaseClient,
  input: ProductInput,
): Promise<{ id: string }> {
  const { data, error } = await client.rpc('create_product', {
    p_name: input.name,
    p_category_code: input.category,
    p_selling_price_incl_gst: input.sellingPriceInclGst,
    p_part_reference: input.partReference,
    p_notes: input.notes,
    p_tyre_condition: input.tyre?.condition ?? null,
    p_tyre_brand: input.tyre?.brand ?? null,
    p_tyre_pattern: input.tyre?.pattern ?? null,
    p_tyre_size: input.tyre?.size ?? null,
    p_load_index: input.tyre?.loadIndex ?? null,
    p_speed_rating: input.tyre?.speedRating ?? null,
  });

  if (error || !data) {
    console.error('[products] create_product failed', error?.message);
    throw new Error(
      error?.message === 'ACCESS_DENIED'
        ? 'Only Admins can create products.'
        : 'Could not create the product.',
    );
  }

  return { id: data as string };
}

export async function setProductActive(
  client: SupabaseClient,
  productId: string,
  active: boolean,
): Promise<void> {
  const { error } = await client.rpc('set_product_active', {
    p_product_id: productId,
    p_active: active,
  });
  if (error) {
    console.error('[products] set_product_active failed', error.message);
    throw new Error('Could not update the product.');
  }
}
