import Link from 'next/link';

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
  type InventoryQuery,
  type InventorySummaryRow,
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
  const scope = await getCurrentLocationScope(access);
  const raw = await searchParams;

  const category = PRODUCT_CATEGORY_CODES.includes(
    one(raw.category) as ProductCategoryCode,
  )
    ? (one(raw.category) as ProductCategoryCode)
    : undefined;
  const condition = one(raw.condition);

  const query: InventoryQuery = {
    scope,
    search: one(raw.q),
    category,
    tyreCondition: condition === 'new' || condition === 'used' ? condition : undefined,
    lowStockOnly: one(raw.low) === '1',
    includeArchived: one(raw.archived) === '1',
  };

  const supabase = await createServerSupabaseClient();
  let rows: InventorySummaryRow[];
  let loadError = false;
  try {
    rows = await searchInventory(supabase, access, query);
  } catch {
    rows = [];
    loadError = true;
  }

  const params = {
    q: one(raw.q) ?? '',
    category: one(raw.category) ?? '',
    condition: condition ?? '',
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
        <InventoryView
          rows={rows}
          scope={scope}
          canViewCost={hasPermission(access, 'inventory.view_cost')}
        />
      )}
    </div>
  );
}
