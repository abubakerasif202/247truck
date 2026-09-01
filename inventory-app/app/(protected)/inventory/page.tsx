import Link from 'next/link';

import { ProductTable } from '@/components/inventory/product-table';
import { getCurrentAccess } from '@/lib/auth/access';
import {
  PRODUCT_CATEGORY_CODES,
  PRODUCT_CATEGORY_LABELS,
  type ProductCategoryCode,
} from '@/lib/products/types';
import { listProducts, type ProductFilters } from '@/lib/products/repository';
import type { ProductSummary } from '@/lib/products/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(raw: SearchParams): ProductFilters {
  const params = {
    q: one(raw.q),
    category: one(raw.category),
    condition: one(raw.condition),
    archived: one(raw.archived),
  };
  const category = PRODUCT_CATEGORY_CODES.includes(
    params.category as ProductCategoryCode,
  )
    ? (params.category as ProductCategoryCode)
    : undefined;
  const tyreCondition =
    params.condition === 'new' || params.condition === 'used'
      ? params.condition
      : undefined;
  return {
    search: params.q,
    category,
    tyreCondition,
    activeOnly: params.archived !== '1',
  };
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await getCurrentAccess();
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const params = {
    q: one(raw.q) ?? '',
    category: one(raw.category) ?? '',
    condition: one(raw.condition) ?? '',
    archived: one(raw.archived) ?? '',
  };

  const supabase = await createServerSupabaseClient();
  let products: ProductSummary[];
  let loadError = false;
  try {
    products = await listProducts(supabase, filters);
  } catch {
    products = [];
    loadError = true;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">Product catalogue</p>
        </div>
        {access.role === 'admin' ? (
          <Link
            href="/inventory/new"
            className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            New Product
          </Link>
        ) : null}
      </header>

      <form className="flex flex-wrap gap-3" role="search">
        <input
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search name or reference"
          className="h-10 min-w-48 flex-1 rounded-md border border-input bg-card px-3 text-sm"
        />
        <select
          name="category"
          defaultValue={params.category ?? ''}
          className="h-10 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">All categories</option>
          {PRODUCT_CATEGORY_CODES.map((code) => (
            <option key={code} value={code}>
              {PRODUCT_CATEGORY_LABELS[code]}
            </option>
          ))}
        </select>
        <select
          name="condition"
          defaultValue={params.condition ?? ''}
          className="h-10 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">New &amp; used</option>
          <option value="new">New tyres</option>
          <option value="used">Used tyres</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={params.archived === '1'}
            className="size-4"
          />
          Include archived
        </label>
        <button
          type="submit"
          className="h-10 rounded-md border border-input px-4 text-sm font-medium"
        >
          Apply
        </button>
      </form>

      {loadError ? (
        <p className="text-sm text-destructive">Could not load products. Please refresh.</p>
      ) : (
        <ProductTable products={products} />
      )}
    </div>
  );
}
