import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Clock, Package, Tag } from 'lucide-react';

import {
  assignOpeningStockCostAction,
  setProductPricesAction,
  updateProductDetailsAction,
} from '@/app/(protected)/inventory/actions';
import { ArchiveToggle } from '@/components/inventory/archive-toggle';
import { AssignOpeningCostForm } from '@/components/inventory/assign-opening-cost-form';
import { ReorderSettingsForm } from '@/components/inventory/reorder-settings-form';
import { SetSellingPriceForm } from '@/components/inventory/set-selling-price-form';
import { ProductDetailsForm } from '@/components/inventory/product-details-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { StockLevelBar } from '@/components/ui/stock-level-bar';
import { TyreVisual } from '@/components/ui/tyre-visual';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { getCurrentAccess } from '@/lib/auth/access';
import { LOCATION_NAMES } from '@/lib/app-config';
import { hasPermission } from '@/lib/auth/permissions';
import { formatAud, formatAudOrPending, formatTyreMeta } from '@/lib/format';
import { listPendingOpeningCosts } from '@/lib/inventory/repository';
import { getProductMovementHistory, searchInventory } from '@/lib/inventory/queries';
import type { PendingOpeningCost } from '@/lib/inventory/types';
import { getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import type { LocationScope } from '@/lib/location/scope';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/products/types';
import { getProduct } from '@/lib/products/repository';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type UsedUnitRow = {
  id: string;
  internal_unit_code: string;
  tread_depth_mm: number;
  condition: string;
  status: string;
  locations: { code: string } | null;
};

export default async function ProductDetailPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { productId } = await params;
  const { created } = await searchParams;
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.view')) redirect('/dashboard');
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();
  const isAdmin = access.role === 'admin';

  // Admins need all locations for opening-cost checks. Fetch that once and
  // derive the selected branch view from it instead of querying the summary twice.
  const summaryScope: LocationScope = isAdmin ? { kind: 'all' } : scope;

  // Same principle as "Stock by branch" below: the selected location scope is
  // authoritative for location-scoped operational data, so Activity follows it
  // too (null only for an Admin's explicit "All Locations" scope — see the
  // recentMovementsPromise precedent in lib/inventory/queries.ts).
  const activityLocationId = await getCurrentScopeLocationId(access, scope);

  const pendingOpeningCostsPromise: Promise<PendingOpeningCost[]> = isAdmin
    ? (async () => {
        const { data: locations } = await supabase
          .from('locations')
          .select('id, code')
          .in('code', ['LON', 'REG'])
          .returns<Array<{ id: string; code: 'LON' | 'REG' }>>();
        return (await Promise.all((locations ?? []).map((location) =>
          listPendingOpeningCosts(supabase, productId, location.id),
        ))).flat();
      })()
    : Promise.resolve([]);

  const [product, summaryPage, unitsResult, pendingOpeningCosts, movementHistory] = await Promise.all([
    getProduct(supabase, productId),
    searchInventory(supabase, access, {
      scope: summaryScope,
      productId,
      includeArchived: true,
    }),
    supabase
      .from('used_tyre_units')
      .select('id, internal_unit_code, tread_depth_mm, condition, status, locations(code)')
      .eq('product_id', productId)
      .order('internal_unit_code')
      .returns<UsedUnitRow[]>(),
    pendingOpeningCostsPromise,
    getProductMovementHistory(supabase, productId, { limit: 15, locationId: activityLocationId ?? undefined }),
  ]);

  if (!product) notFound();

  const allSummaryRows = summaryPage.rows;
  const summaryRows =
    isAdmin && scope.kind === 'location'
      ? allSummaryRows.filter((row) => row.locationCode === scope.code)
      : allSummaryRows;
  const units = unitsResult.data ?? [];

  const canStockIn = hasPermission(access, 'inventory.stock_in');
  const canStockOut = hasPermission(access, 'inventory.stock_out');
  const canAdjust = hasPermission(access, 'inventory.adjust');
  const canViewCost = hasPermission(access, 'inventory.view_cost');
  const canEditPrice = hasPermission(access, 'inventory.edit_global_price');

  const hasUnvaluedOpeningStock = pendingOpeningCosts.length > 0;

  const sellingPriceAction = setProductPricesAction.bind(null, product.id);
  const openingCostAction = assignOpeningStockCostAction.bind(null, product.id);

  return (
    <div className="operations-page max-w-5xl domain-inventory">
      <Link href="/inventory" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        ← Inventory
      </Link>

      <PageHeader
        domain="inventory"
        eyebrow="Product record"
        title={product.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {product.categoryCode ? PRODUCT_CATEGORY_LABELS[product.categoryCode] : 'Uncategorised'}
            <StatusBadge status={product.active ? 'active' : 'inactive'}>
              {product.active ? 'Active' : 'Archived'}
            </StatusBadge>
            {product.tyreCondition ? (
              <StatusBadge status={`${product.tyreCondition}_tyre`}>
                {product.tyreCondition === 'used' ? 'Used tyre' : 'New tyre'}
              </StatusBadge>
            ) : null}
          </span>
        }
        actions={access.role === 'admin' ? (
          <ArchiveToggle productId={product.id} active={product.active} />
        ) : null}
      />
      {created === '1' ? <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">Product created successfully.</p> : null}

      {/* Identity hero — tyre visual + the prominent size the brief asks for, kept as a
          separate block from PageHeader so PageHeader's props/behaviour stay untouched. */}
      <section className="operations-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        {product.tyreCondition ? (
          <TyreVisual size="lg" condition={product.tyreCondition} className="mx-auto shrink-0 text-inventory sm:mx-0" />
        ) : (
          <span className="mx-auto flex size-16 shrink-0 items-center justify-center rounded-full bg-inventory-soft text-inventory sm:mx-0">
            <Package className="size-7" />
          </span>
        )}
        <div className="min-w-0 flex-1 text-center sm:text-left">
          {product.brandName || product.patternName ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {[product.brandName, product.patternName].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {product.sizeName ? (
            <p className="metric-value break-words font-display text-3xl leading-tight text-foreground sm:text-4xl">{product.sizeName}</p>
          ) : product.tyreCondition ? (
            <p className="text-sm text-muted-foreground">No tyre size on record.</p>
          ) : null}
          {product.partReference ? <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground sm:justify-start">
            <Tag className="size-3.5" aria-hidden="true" />
            Ref: <span className="font-medium text-foreground">{product.partReference}</span>
          </p> : null}
        </div>
        <div className="mx-auto text-center sm:mx-0 sm:text-right">
          <p className="text-xs text-muted-foreground">Retail (GST incl.)</p>
          <p className="metric-value text-2xl">{formatAudOrPending(product.retailPriceInclGst)}</p>
          {product.retailPriceInclGst == null ? <StatusBadge tone="warning" className="mt-1">Retail price pending</StatusBadge> : null}
        </div>
      </section>

      {hasUnvaluedOpeningStock ? (
        <div className="operations-panel border-l-4 border-l-warning p-4">
          <StatusBadge tone="warning">Opening cost pending</StatusBadge>
          <p className="mt-2 text-sm text-muted-foreground">
            Positive opening stock exists without a confirmed cost. It is excluded from known inventory value until cost is assigned.
          </p>
        </div>
      ) : null}

      <section className="operations-panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Stock by branch</h2>
        <ul className="flex flex-col divide-y divide-border">
          {summaryRows.map((row) => (
            <li key={row.locationCode} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="location-chip" data-location={row.locationCode}>{row.locationCode}</span>
                {row.locationName}
              </span>
              <span className="flex flex-wrap items-center justify-end gap-3">
                <StockLevelBar onHand={row.available} minimumStock={row.minimumStock} suffix="available" />
                {row.lowStock ? <StatusBadge status="low stock">Low stock</StatusBadge> : null}
                {canViewCost && row.onHand > 0 && row.weightedAverageCost == null ? (
                  <StatusBadge tone="warning">Opening cost pending</StatusBadge>
                ) : null}
                {canViewCost && row.weightedAverageCost != null ? (
                  <span className="text-xs text-muted-foreground">WAC {formatAud(row.weightedAverageCost)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="operations-panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Product information</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="mt-0.5">{product.categoryCode ? PRODUCT_CATEGORY_LABELS[product.categoryCode] : 'Uncategorised'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Condition</dt>
            <dd className="mt-0.5">{product.tyreCondition ? (product.tyreCondition === 'used' ? 'Used' : 'New') : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Brand</dt>
            <dd className="mt-0.5">{product.brandName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pattern</dt>
            <dd className="mt-0.5">{product.patternName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="mt-0.5">{product.sizeName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Load index / speed rating</dt>
            <dd className="mt-0.5">{[product.loadIndex, product.speedRating].filter(Boolean).join(' / ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Wholesale price (GST incl.)</dt>
            <dd className="mt-0.5">{formatAudOrPending(product.wholesalePriceInclGst)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tyre summary</dt>
            <dd className="mt-0.5">
              {formatTyreMeta({
                condition: product.tyreCondition,
                brand: product.brandName,
                pattern: product.patternName,
                size: product.sizeName,
              })}
            </dd>
          </div>
          {product.notes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{product.notes}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {isAdmin ? <ProductDetailsForm product={product} action={updateProductDetailsAction.bind(null, product.id)} /> : null}

      {canEditPrice ? (
        <SetSellingPriceForm
          currentRetailPrice={product.retailPriceInclGst}
          currentWholesalePrice={product.wholesalePriceInclGst}
          action={sellingPriceAction}
        />
      ) : null}

      {access.role === 'admin' && pendingOpeningCosts.length > 0 ? (
        <AssignOpeningCostForm pending={pendingOpeningCosts} action={openingCostAction} />
      ) : null}

      {(canStockIn || canStockOut || canAdjust) ? (
        <section className="flex flex-wrap gap-2">
          {canStockIn ? (
            <Link href="/stock/in" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Stock In
            </Link>
          ) : null}
          {canStockOut ? (
            <Link href="/stock/out" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Stock Out
            </Link>
          ) : null}
          {canAdjust ? (
            <Link href="/stock/adjust" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Adjust
            </Link>
          ) : null}
          {canStockIn && product.tyreCondition === 'used' ? (
            <Link href="/stock/used-intake" className="h-11 rounded-md border border-input px-4 text-sm font-medium leading-[2.75rem]">
              Add used unit
            </Link>
          ) : null}
        </section>
      ) : null}

      {access.role === 'admin' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Reorder thresholds</h2>
          <ReorderSettingsForm
            productId={product.id}
            rows={(['LON', 'REG'] as const).map((code) => {
              const row = allSummaryRows.find((item) => item.locationCode === code);
              return {
                locationCode: code,
                minimumStock: row?.minimumStock ?? 0,
                reorderQuantity: row?.reorderQuantity ?? 0,
              };
            })}
          />
        </section>
      ) : null}

      {product.tyreCondition === 'used' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Individually tracked units</h2>
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No individual units yet. Units are created with their intake stock movement.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {units.map((unit) => (
                <li key={unit.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <span className="font-medium">{unit.internal_unit_code}</span>
                  <span className="ml-2 text-muted-foreground">
                    {unit.locations?.code ? LOCATION_NAMES[unit.locations.code as 'LON' | 'REG'] : '—'} · {unit.tread_depth_mm}mm · {unit.condition} · {unit.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="operations-panel flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Recent activity</h2>
        </div>
        <RecentActivity movements={movementHistory} />
      </section>
    </div>
  );
}
