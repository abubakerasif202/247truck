import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeLookup } from '@/lib/products/validation';

import type { OpeningStockRow, OpeningStockSource } from './types';

export type OpeningStockImportReport = {
  sourceRows: number;
  sourceQuantity: number;
  createdProducts: number;
  matchedProducts: number;
  postedRows: number;
  postedQuantity: number;
  replayedRows: number;
  errors: Array<{ rowNumber: number; rowKey: string; message: string }>;
};

export type OpeningStockPreviewRow = OpeningStockRow & {
  matchStatus: 'create' | 'match' | 'ambiguous';
  matchedProductId: string | null;
};

export type OpeningStockPreview = {
  rows: OpeningStockPreviewRow[];
  createCount: number;
  matchCount: number;
  ambiguousCount: number;
};

type ImportRpcRow = {
  product_id: string;
  movement_id: string;
  created_product: boolean;
  replayed: boolean;
};

type ProductIdentityRow = {
  id: string;
  category_code: string;
  tyre_condition: string | null;
  tyre_brands: { normalized_name: string } | null;
  tyre_patterns: { normalized_name: string } | null;
  tyre_sizes: { normalized_size: string } | null;
};

function single<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function productIdentity(row: ProductIdentityRow): string | null {
  if (
    row.category_code !== 'truck_tyre' ||
    row.tyre_condition !== 'new' ||
    !row.tyre_brands?.normalized_name ||
    !row.tyre_sizes?.normalized_size
  ) {
    return null;
  }

  return [
    normalizeLookup(row.tyre_brands.normalized_name),
    normalizeLookup(row.tyre_patterns?.normalized_name ?? ''),
    normalizeLookup(row.tyre_sizes.normalized_size),
    'NEW',
  ].join('|');
}

export async function previewOpeningStockDataset(
  client: SupabaseClient,
  source: OpeningStockSource,
): Promise<OpeningStockPreview> {
  const { data, error } = await client
    .from('products')
    .select(
      'id, category_code, tyre_condition, tyre_brands(normalized_name), tyre_patterns(normalized_name), tyre_sizes(normalized_size)',
    )
    .eq('category_code', 'truck_tyre')
    .eq('tyre_condition', 'new')
    .returns<ProductIdentityRow[]>();

  if (error) {
    console.error('[opening-stock] preview product lookup failed', error.message);
    throw new Error('Could not preview the opening stock import.');
  }

  const identityMap = new Map<string, string[]>();
  for (const product of data ?? []) {
    const key = productIdentity(product);
    if (!key) continue;
    const ids = identityMap.get(key) ?? [];
    ids.push(product.id);
    identityMap.set(key, ids);
  }

  const rows: OpeningStockPreviewRow[] = source.rows.map((row) => {
    const matches = identityMap.get(row.rowKey) ?? [];
    return {
      ...row,
      matchStatus:
        matches.length === 0
          ? 'create'
          : matches.length === 1
            ? 'match'
            : 'ambiguous',
      matchedProductId: matches.length === 1 ? matches[0]! : null,
    };
  });

  return {
    rows,
    createCount: rows.filter((row) => row.matchStatus === 'create').length,
    matchCount: rows.filter((row) => row.matchStatus === 'match').length,
    ambiguousCount: rows.filter((row) => row.matchStatus === 'ambiguous').length,
  };
}

export async function importOpeningStockDataset(
  client: SupabaseClient,
  source: OpeningStockSource,
): Promise<OpeningStockImportReport> {
  const report: OpeningStockImportReport = {
    sourceRows: source.rows.length,
    sourceQuantity: source.totalQuantity,
    createdProducts: 0,
    matchedProducts: 0,
    postedRows: 0,
    postedQuantity: 0,
    replayedRows: 0,
    errors: [],
  };

  let accountedQuantity = 0;

  for (const row of source.rows) {
    const { data, error } = await client.rpc('import_opening_stock_row', {
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

    if (error) {
      report.errors.push({
        rowNumber: row.rowNumber,
        rowKey: row.rowKey,
        message: error.message,
      });
      continue;
    }

    const result = single<ImportRpcRow>(data);
    if (!result) {
      report.errors.push({
        rowNumber: row.rowNumber,
        rowKey: row.rowKey,
        message: 'Opening stock row returned no result.',
      });
      continue;
    }

    accountedQuantity += row.quantity;

    if (result.replayed) {
      report.replayedRows += 1;
      continue;
    }

    report.postedRows += 1;
    report.postedQuantity += row.quantity;
    if (result.created_product) report.createdProducts += 1;
    else report.matchedProducts += 1;
  }

  if (report.errors.length === 0 && accountedQuantity !== source.totalQuantity) {
    throw new Error('Opening stock import did not account for the full source quantity.');
  }

  if (
    report.errors.length === 0 &&
    report.replayedRows === 0 &&
    report.postedQuantity !== 725
  ) {
    throw new Error('Opening stock import quantity did not reconcile to 725.');
  }

  return report;
}
