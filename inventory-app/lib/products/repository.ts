import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProductCategoryCode, ProductSummary } from './types';
import type { ProductInput } from './validation';

type ProductRow = {
  id: string;
  name: string;
  category_code: ProductCategoryCode | null;
  part_reference: string | null;
  retail_price_incl_gst: number | null;
  wholesale_price_incl_gst: number | null;
  selling_price_incl_gst: number | null;
  active: boolean;
  tyre_condition: 'new' | 'used' | null;
  tyre_brands: { display_name: string } | null;
  tyre_patterns: { display_name: string } | null;
  tyre_sizes: { display_size: string } | null;
};

const PRODUCT_SELECT =
  'id, name, category_code, part_reference, retail_price_incl_gst, wholesale_price_incl_gst, selling_price_incl_gst, active, tyre_condition, ' +
  'tyre_brands(display_name), tyre_patterns(display_name), tyre_sizes(display_size)';

function toSummary(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    categoryCode: row.category_code,
    partReference: row.part_reference,
    retailPriceInclGst:
      row.retail_price_incl_gst == null
        ? null
        : Number(row.retail_price_incl_gst),
    wholesalePriceInclGst:
      row.wholesale_price_incl_gst == null ? null : Number(row.wholesale_price_incl_gst),
    sellingPriceInclGst:
      row.selling_price_incl_gst == null ? null : Number(row.selling_price_incl_gst),
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
 * Creates a product via the `create_product_with_prices` RPC — a single
 * SECURITY DEFINER transaction that re-checks Admin, upserts normalised tyre
 * lookups with ON CONFLICT, inserts the product (a trigger zero-fills
 * `inventory_settings` for both locations), sets retail/wholesale pricing,
 * and writes the `PRODUCT_CREATED` audit row atomically. (`create_product`
 * only accepts a single legacy `p_selling_price_incl_gst` and has no retail/
 * wholesale parameters at all — calling it with this input's field names
 * fails every time with PGRST202, "could not find the function".)
 */
export async function createProduct(
  client: SupabaseClient,
  input: ProductInput,
  locationId: string,
): Promise<{ id: string }> {
  const { data, error } = await client.rpc('create_workspace_product', {
    p_location_id: locationId,
    p_name: input.name,
    p_category_code: input.category,
    p_retail_price_incl_gst: input.retailPriceInclGst,
    p_wholesale_price_incl_gst: input.wholesalePriceInclGst,
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
    console.error('[products] create_workspace_product failed', error?.message);
    const messages: Record<string,string> = { ACCESS_DENIED: 'Only Admins can create products.', PRODUCT_NAME_REQUIRED: 'Product name is required.', RETAIL_PRICE_REQUIRED: 'Retail price must be a valid amount.', INVALID_PRODUCT_WORKSPACE: 'Unable to create product because the selected business is invalid.', INVALID_PRODUCT_CATEGORY: 'Select a valid category.', INVALID_PRICE: 'Enter a valid product price.' };
    throw new Error(messages[error?.message ?? ''] ?? 'Could not create the product. Please retry.');
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

export async function setProductPrices(
  client: SupabaseClient,
  productId: string,
  retailPrice: number | null,
  wholesalePrice: number | null,
): Promise<void> {
  const { error } = await client.rpc('set_product_prices', {
    p_product_id: productId,
    p_retail_price_incl_gst: retailPrice,
    p_wholesale_price_incl_gst: wholesalePrice,
  });
  if (error) {
    console.error('[products] set_product_prices failed', error.message);
    throw new Error(
      error.message.includes('ACCESS_DENIED')
        ? 'You do not have permission to edit product pricing.'
        : 'Could not update product pricing.',
    );
  }
}
