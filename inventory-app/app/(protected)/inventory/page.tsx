import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Filter, Search, X } from 'lucide-react';

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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

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

  // Validated values, not raw query-string values — an invalid `?category=` or
  // `?condition=` never reaches `searchInventory` (see `query` above), so chips/hrefs
  // built from the raw string would otherwise show a filter that isn't actually applied.
  const params = {
    q: one(raw.q) ?? '',
    category: category ?? '',
    condition: condition === 'new' || condition === 'used' ? condition : '',
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

  const isLow = one(raw.low) === '1';
  const isArchived = one(raw.archived) === '1';

  /** Same params as pageHref, minus one filter — used for removable chips. Always drops `page`. */
  function hrefWithout(exclude: 'q' | 'category' | 'condition' | 'low' | 'archived'): string {
    const search = new URLSearchParams();
    if (exclude !== 'q' && params.q) search.set('q', params.q);
    if (exclude !== 'category' && params.category) search.set('category', params.category);
    if (exclude !== 'condition' && params.condition) search.set('condition', params.condition);
    if (exclude !== 'low' && isLow) search.set('low', '1');
    if (exclude !== 'archived' && isArchived) search.set('archived', '1');
    const qs = search.toString();
    return qs ? `/inventory?${qs}` : '/inventory';
  }

  const chips: { key: 'q' | 'category' | 'condition' | 'low' | 'archived'; label: string }[] = [];
  if (params.q) chips.push({ key: 'q', label: `"${params.q}"` });
  if (params.category) chips.push({ key: 'category', label: PRODUCT_CATEGORY_LABELS[params.category as ProductCategoryCode] });
  if (params.condition) chips.push({ key: 'condition', label: params.condition === 'new' ? 'New tyres' : 'Used tyres' });
  if (isLow) chips.push({ key: 'low', label: 'Low stock' });
  if (isArchived) chips.push({ key: 'archived', label: 'Archived included' });
  const filterOnlyCount = chips.filter((c) => c.key !== 'q').length;

  // Fixed per filter-type — never the dynamic chip.label — because a chip whose
  // accessible name contains the raw search term is a substring match away from
  // colliding with a same-named product's own link (tests/e2e/inventory-admin.spec.ts
  // caught this for real: `getByRole('link', { name: <product name> }).first()`
  // resolved to the "E2E New Line-Haul 315/80R22.5" search chip instead of the
  // product row, since the chip rendered before the table in DOM order).
  const FILTER_TYPE_LABEL: Record<(typeof chips)[number]['key'], string> = {
    q: 'search',
    category: 'category',
    condition: 'condition',
    low: 'low stock',
    archived: 'archived',
  };

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
                href="/inventory/opening-stock"
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
              >
                Add Opening Stock
              </Link>
              <Link
                href="/inventory/import"
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
              >
                Historical/Bulk Opening Stock Import
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

      {/*
       * ONE search form for both breakpoints — deliberately not duplicated per
       * breakpoint. tests/e2e/{inventory-admin,inventory-manager,mobile-stock}.spec.ts
       * all call page.getByLabel('Search products'), which throws a Playwright
       * strict-mode violation if two elements ever share that accessible name.
       * The category/condition/low/archived controls are CSS-hidden on mobile
       * (still present, still submit their current value on Apply) and edited
       * instead through the separate Filters sheet below.
       */}
      <div className="flex items-start gap-2">
        <form className="operations-panel flex flex-1 flex-wrap items-center gap-3 p-4" role="search" noValidate>
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            name="q"
            aria-label="Search products"
            defaultValue={params.q}
            placeholder="Name, reference, brand, pattern, size"
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          />
          <div className="hidden flex-wrap items-center gap-3 md:flex">
            <select
              name="category"
              aria-label="Category"
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
              aria-label="Tyre condition"
              defaultValue={params.condition}
              className="h-10 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">New &amp; used</option>
              <option value="new">New tyres</option>
              <option value="used">Used tyres</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="low" value="1" defaultChecked={isLow} className="size-4" />
              Low stock only
            </label>
            {hasPermission(access, 'inventory.stock_in') ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="archived" value="1" defaultChecked={isArchived} className="size-4" />
                Include archived
              </label>
            ) : null}
          </div>
          {/* Hidden on mobile — the search input is type="search" (native keyboard submits
              it), and filter changes route through the sheet's own "Show results" button. */}
          <button type="submit" className="hidden h-10 rounded-md border border-input px-4 text-sm font-medium md:inline-flex">
            Apply
          </button>
        </form>

        <Sheet>
          <SheetTrigger
            render={<Button type="button" variant="outline" className="relative h-10 shrink-0 px-3 md:hidden" />}
          >
            <Filter className="size-4" aria-hidden="true" />
            Filters
            {filterOnlyCount > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-brand-red text-[10px] font-bold text-white">
                {filterOnlyCount}
              </span>
            ) : null}
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            <SheetHeader>
              <SheetTitle>Filter inventory</SheetTitle>
            </SheetHeader>
            <form className="flex flex-col gap-4 p-4 pt-0" role="search" noValidate>
              <input type="hidden" name="q" value={params.q} />
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Category</span>
                <select name="category" defaultValue={params.category} className="h-11 rounded-md border border-input bg-card px-3 text-sm">
                  <option value="">All categories</option>
                  {PRODUCT_CATEGORY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {PRODUCT_CATEGORY_LABELS[code]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Tyre condition</span>
                <select name="condition" defaultValue={params.condition} className="h-11 rounded-md border border-input bg-card px-3 text-sm">
                  <option value="">New &amp; used</option>
                  <option value="new">New tyres</option>
                  <option value="used">Used tyres</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="low" value="1" defaultChecked={isLow} className="size-4" />
                Low stock only
              </label>
              {hasPermission(access, 'inventory.stock_in') ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="archived" value="1" defaultChecked={isArchived} className="size-4" />
                  Include archived
                </label>
              ) : null}
              {/*
               * "Show results", not "Apply" — tests/e2e/inventory-admin.spec.ts does
               * getByRole('button', { name: 'Apply' }), which Playwright matches as a
               * case-insensitive SUBSTRING by default, so "Apply filters" here would
               * collide with the main toolbar's "Apply" button.
               */}
              <button type="submit" className="h-11 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-sm">
                Show results
              </button>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-brand-red/25 bg-brand-red-soft py-1 pr-1.5 pl-2.5 text-xs font-medium text-brand-deep-red"
            >
              {chip.label}
              <Link
                href={hrefWithout(chip.key)}
                aria-label={`Remove ${FILTER_TYPE_LABEL[chip.key]} filter`}
                className="rounded-full p-0.5 transition-colors hover:bg-brand-red-soft/70"
              >
                <X className="size-3.5" aria-hidden="true" />
              </Link>
            </span>
          ))}
          <Link href="/inventory" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Clear filters
          </Link>
        </div>
      ) : null}

      {loadError ? (
        <EmptyState
          tone="error"
          title="Unable to load inventory"
          description="We couldn't retrieve the latest inventory data right now. Refresh the page to try again."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            <span className="metric-value font-semibold text-foreground">{result.totalProducts}</span>{' '}
            {result.totalProducts === 1 ? 'product' : 'products'} match{chips.length > 0 ? ' your filters' : ''}
          </p>
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
