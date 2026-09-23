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
  load_index: string | null;
  speed_rating: string | null;
  notes: string | null;
};

const PRODUCT_SELECT =
  'id, name, category_code, part_reference, retail_price_incl_gst, wholesale_price_incl_gst, selling_price_incl_gst, active, tyre_condition, load_index, speed_rating, notes, ' +
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
    loadIndex: row.load_index,
    speedRating: row.speed_rating,
    notes: row.notes,
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
 * Creates a workspace-owned product through the current dual-price RPC. The
 * location parameter keeps the product, zero-stock seed rows, and audit event
 * inside the selected business workspace. This supersedes both the obsolete
 * single-price `create_product` path and the older shared-product
 * `create_product_with_prices` path while retaining retail/wholesale pricing.
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
    const messages: Record<string,string> = { ACCESS_DENIED: 'Only Admins can create products.', PRODUCT_NAME_REQUIRED: 'Product name is required.', INVALID_PRODUCT_WORKSPACE: 'Unable to create product because the selected business is invalid.', INVALID_PRODUCT_CATEGORY: 'Select a valid category.', INVALID_PRICE: 'Enter a valid product price.' };
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

export async function updateProductDetails(
  client: SupabaseClient,
  productId: string,
  input: Pick<ProductInput, 'name' | 'category' | 'partReference' | 'notes' | 'tyre'>,
): Promise<void> {
  const { error } = await client.rpc('update_product_details', {
    p_product_id: productId,
    p_name: input.name,
    p_category_code: input.category,
    p_part_reference: input.partReference,
    p_notes: input.notes,
    p_tyre_condition: input.tyre?.condition ?? null,
    p_tyre_brand: input.tyre?.brand ?? null,
    p_tyre_pattern: input.tyre?.pattern ?? null,
    p_tyre_size: input.tyre?.size ?? null,
    p_load_index: input.tyre?.loadIndex ?? null,
    p_speed_rating: input.tyre?.speedRating ?? null,
  });
  if (error) {
    console.error('[products] update_product_details failed', error.message);
    throw new Error(error.message === 'TRACKED_USED_UNITS_EXIST'
      ? 'This product has tracked used tyre units. Its condition must remain Used.'
      : 'Could not update product details.');
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
