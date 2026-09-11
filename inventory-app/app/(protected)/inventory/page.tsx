import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InventoryView } from '@/components/inventory/inventory-view';
import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { hasPermission } from '@/lib/auth/permissions';
import {
  PRODUCT_CATEGORY_CODES,
  PRODUCT_CATEGORY_LABELS,
  type ProductCategoryCode,
} from '@/lib/products/types';
import {
  searchInventory,
  type InventoryPage as InventoryPageResult,
  type InventoryQuery,
} from '@/lib/inventory/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.view')) redirect('/dashboard');
  const scope = await getCurrentLocationScope(access);
  const raw = await searchParams;

  const category = PRODUCT_CATEGORY_CODES.includes(
    one(raw.category) as ProductCategoryCode,
  )
    ? (one(raw.category) as ProductCategoryCode)
    : undefined;
  const condition = one(raw.condition);
  const requestedPage = Number.parseInt(one(raw.page) ?? '1', 10);
  const currentPage = Number.isFinite(requestedPage) && requestedPage >= 1 ? requestedPage : 1;

  const query: InventoryQuery & { page?: number } = {
    scope,
    search: one(raw.q),
    category,
    tyreCondition: condition === 'new' || condition === 'used' ? condition : undefined,
    lowStockOnly: one(raw.low) === '1',
    includeArchived: one(raw.archived) === '1',
    page: currentPage,
  };

  const supabase = await createServerSupabaseClient();
  let result: InventoryPageResult;
  let loadError = false;
  try {
    result = await searchInventory(supabase, access, query);
  } catch {
    result = { rows: [], totalProducts: 0, page: currentPage, limit: 50, hasMore: false };
    loadError = true;
  }

  const totalPages = Math.max(1, Math.ceil(result.totalProducts / result.limit));

  const params = {
    q: one(raw.q) ?? '',
    category: one(raw.category) ?? '',
    condition: condition ?? '',
  };

  function pageHref(target: number): string {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.category) search.set('category', params.category);
    if (params.condition) search.set('condition', params.condition);
    if (one(raw.low) === '1') search.set('low', '1');
    if (one(raw.archived) === '1') search.set('archived', '1');
    if (target > 1) search.set('page', String(target));
    const qs = search.toString();
    return qs ? `/inventory?${qs}` : '/inventory';
  }

  return (
    <div className="operations-page max-w-6xl domain-inventory">
      <PageHeader
        domain="inventory"
        title="Inventory"
        subtitle={`${scope.kind === 'all' ? 'All locations' : scope.code} · Live stock`}
        actions={
          access.role === 'admin' ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href="/inventory/import"
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
              >
                Opening Stock Import
              </Link>
              <Link
                href="/inventory/new"
                className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-brand-crimson"
              >
                New Product
              </Link>
            </div>
          ) : null
        }
      />

      <form className="operations-panel flex flex-wrap gap-3 p-4" role="search" noValidate>
        <input
          name="q"
          defaultValue={params.q}
          placeholder="Name, reference, brand, pattern, size"
          className="h-10 min-w-48 flex-1 rounded-md border border-input bg-card px-3 text-sm"
        />
        <select
          name="category"
          defaultValue={params.category}
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
          defaultValue={params.condition}
          className="h-10 rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">New &amp; used</option>
          <option value="new">New tyres</option>
          <option value="used">Used tyres</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="low" value="1" defaultChecked={one(raw.low) === '1'} className="size-4" />
          Low stock only
        </label>
        {hasPermission(access, 'inventory.stock_in') ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="archived" value="1" defaultChecked={one(raw.archived) === '1'} className="size-4" />
            Include archived
          </label>
        ) : null}
        <button type="submit" className="h-10 rounded-md border border-input px-4 text-sm font-medium">
          Apply
        </button>
      </form>

      {loadError ? (
        <p className="text-sm text-destructive">Could not load inventory. Please refresh.</p>
      ) : (
        <>
          <InventoryView
            rows={result.rows}
            scope={scope}
            canViewCost={hasPermission(access, 'inventory.view_cost')}
          />
          <nav
            aria-label="Inventory pagination"
            className="flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted-foreground">
              Page {result.page} of {totalPages} · {result.totalProducts} products
              {result.hasMore ? ' · more available' : ''}
            </span>
            <span className="flex flex-wrap gap-2">
              {result.page > 1 ? (
                <Link
                  href={pageHref(result.page - 1)}
                  className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
                >
                  Previous
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10 text-muted-foreground opacity-50"
                >
                  Previous
                </span>
              )}
              {result.hasMore ? (
                <Link
                  href={pageHref(result.page + 1)}
                  className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
                >
                  Next
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10 text-muted-foreground opacity-50"
                >
                  Next
                </span>
              )}
            </span>
          </nav>
        </>
      )}
    </div>
  );
}
