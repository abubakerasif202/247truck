import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Banknote, PackageX, ShoppingCart, TriangleAlert, Truck, Warehouse } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { DistributionBars } from '@/components/analytics/distribution-bars';
import { MovementBars } from '@/components/analytics/movement-bars';
import { ReplenishmentPreview } from '@/components/analytics/replenishment-preview';
import { MovementTables } from '@/components/analytics/movement-tables';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentScopeLocationId, describeLocationScope } from '@/lib/location/resolve-scope';
import { resolveLocationScope } from '@/lib/location/scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatAudOrPending } from '@/lib/format';
import { getDashboardInventoryMetrics } from '@/lib/inventory/queries';
import { getPurchasingDashboardCounts, listPurchaseOrderLocations, listReorderSuggestions } from '@/lib/purchasing/queries';
import {
  getFastMovingProducts,
  getInventoryByBrand,
  getInventoryByCategory,
  getInventoryBySize,
  getPurchasingAnalyticsSummary,
  getReceivablesAnalyticsSummary,
  getSlowMovingProducts,
  getStockMovementSummary,
} from '@/lib/analytics/queries';
import type { MovementPeriod, SlowMovingWindow } from '@/lib/analytics/types';
import { cn } from '@/lib/utils';

const MOVEMENT_PERIODS: MovementPeriod[] = [7, 30, 90];
const SLOW_WINDOWS: SlowMovingWindow[] = [30, 60, 90];

function parsePeriod(value: string | undefined, allowed: readonly number[], fallback: number): number {
  const parsed = Number(value);
  return allowed.includes(parsed) ? parsed : fallback;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; movementDays?: string; slowWindow?: string }>;
}) {
  const access = await getCurrentAccess();
  const canViewInventory = hasPermission(access, 'inventory.view');
  const canViewPurchasing = hasPermission(access, 'purchasing.view');
  if (!canViewInventory && !canViewPurchasing) redirect('/dashboard');

  const params = await searchParams;
  const requestedLocation = access.role === 'admin' ? (params.location ?? 'ALL') : null;
  const scope = resolveLocationScope(access, requestedLocation);
  const movementDays = parsePeriod(params.movementDays, MOVEMENT_PERIODS, 30) as MovementPeriod;
  const slowWindow = parsePeriod(params.slowWindow, SLOW_WINDOWS, 90) as SlowMovingWindow;

  const supabase = await createServerSupabaseClient();
  const scopeLocationId = await getCurrentScopeLocationId(access, scope);

  const [
    metrics,
    brandRows,
    sizeRows,
    categoryRows,
    movementSummary,
    fastMoving,
    slowMoving,
    purchasingSummary,
    purchasingCounts,
    receivablesSummary,
    reorderSuggestions,
    locations,
  ] = await Promise.all([
    canViewInventory ? getDashboardInventoryMetrics(supabase, access, scope).catch(() => null) : Promise.resolve(null),
    canViewInventory ? getInventoryByBrand(supabase, access, scope).catch(() => []) : Promise.resolve([]),
    canViewInventory ? getInventoryBySize(supabase, access, scope).catch(() => []) : Promise.resolve([]),
    canViewInventory ? getInventoryByCategory(supabase, access, scope).catch(() => []) : Promise.resolve([]),
    canViewInventory ? getStockMovementSummary(supabase, scope, movementDays).catch(() => null) : Promise.resolve(null),
    canViewInventory ? getFastMovingProducts(supabase, scope, movementDays).catch(() => []) : Promise.resolve([]),
    canViewInventory ? getSlowMovingProducts(supabase, scope, slowWindow).catch(() => []) : Promise.resolve([]),
    canViewPurchasing ? getPurchasingAnalyticsSummary(supabase, scopeLocationId).catch(() => null) : Promise.resolve(null),
    canViewPurchasing ? getPurchasingDashboardCounts(supabase, access, scope).catch(() => null) : Promise.resolve(null),
    getReceivablesAnalyticsSummary(supabase, access, scopeLocationId).catch(() => null),
    canViewPurchasing ? listReorderSuggestions(supabase, scopeLocationId).catch(() => []) : Promise.resolve([]),
    access.role === 'admin' ? listPurchaseOrderLocations(supabase, access).catch(() => []) : Promise.resolve([]),
  ]);

  const canViewValue = hasPermission(access, 'reports.view_inventory_value') && hasPermission(access, 'inventory.view_cost');
  const scopeLabel = describeLocationScope(scope);

  return (
    <div className="operations-page max-w-6xl domain-reports">
      <PageHeader
        domain="reports"
        eyebrow="Operations Intelligence"
        title="Analytics & Replenishment"
        subtitle={`${access.role === 'admin' ? 'Admin' : 'Manager'} · ${scopeLabel} · Real aggregates, not a sample`}
        actions={
          access.role === 'admin' ? (
            <form method="get" className="flex items-end gap-2" noValidate>
              <select
                name="location"
                defaultValue={scope.kind === 'all' ? 'ALL' : scope.code}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                aria-label="Location"
              >
                <option value="ALL">All Locations</option>
                {locations.map((item) => (
                  <option key={item.id} value={item.code}>{item.name}</option>
                ))}
              </select>
              <button type="submit" className={cn(buttonVariants({ variant: 'outline' }), 'h-10')}>View</button>
            </form>
          ) : undefined
        }
      />

      {!canViewInventory && !canViewPurchasing ? (
        <EmptyState title="Analytics unavailable" description="Viewing analytics requires the View stock or View purchasing permission." />
      ) : (
        <>
          <section aria-labelledby="analytics-overview-heading" className="flex flex-col gap-3">
            <h2 id="analytics-overview-heading" className="operations-heading text-base uppercase">Overview</h2>
            {!canViewInventory || !metrics ? (
              <EmptyState title="Inventory metrics unavailable" description="Requires the View stock permission." />
            ) : (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <MetricCard label="Active products" value={metrics.activeProducts} icon={Warehouse} tone="inventory" />
                <MetricCard label="Total on hand" value={metrics.totalOnHand} caption="units in scope" icon={Warehouse} tone="inventory" />
                <MetricCard label="Low-stock products" value={metrics.lowStockItems} icon={TriangleAlert} tone={metrics.lowStockItems > 0 ? 'warning' : 'success'} />
                <MetricCard label="Known inventory value" value={canViewValue ? formatAudOrPending(metrics.inventoryValue) : '—'} caption={canViewValue ? undefined : 'Requires cost permission'} icon={Banknote} tone="brand" />
                <MetricCard label="Open purchase orders" value={purchasingSummary?.openPurchaseOrders ?? '—'} icon={ShoppingCart} tone="neutral" />
                <MetricCard label="Outstanding PO units" value={purchasingSummary?.outstandingPoUnits ?? '—'} caption="already on order" icon={Truck} tone="neutral" />
                <MetricCard label="Outstanding receivables" value={receivablesSummary ? formatAudOrPending(receivablesSummary.outstandingReceivables) : '—'} caption={receivablesSummary ? `${receivablesSummary.outstandingInvoiceCount} invoices` : 'Requires receivables permission'} icon={Banknote} tone={receivablesSummary && receivablesSummary.overdueReceivables > 0 ? 'warning' : 'neutral'} />
                <MetricCard label="Replenishment candidates" value={canViewPurchasing ? reorderSuggestions.length : '—'} icon={PackageX} tone={reorderSuggestions.length > 0 ? 'warning' : 'success'} />
              </dl>
            )}
          </section>

          {canViewInventory ? (
            <section aria-labelledby="analytics-distribution-heading" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <h2 id="analytics-distribution-heading" className="sr-only">Inventory distribution</h2>
              <div className="operations-panel flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">By brand</h3>
                  <a href={`/api/analytics/export?type=brand&location=${scope.kind === 'location' ? scope.code : 'ALL'}`} className="text-xs underline text-muted-foreground">Export CSV</a>
                </div>
                <DistributionBars rows={brandRows} showValue={canViewValue} emptyMessage="No products with stock in scope." />
              </div>
              <div className="operations-panel flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">By size</h3>
                  <a href={`/api/analytics/export?type=size&location=${scope.kind === 'location' ? scope.code : 'ALL'}`} className="text-xs underline text-muted-foreground">Export CSV</a>
                </div>
                <DistributionBars rows={sizeRows} showValue={canViewValue} emptyMessage="No products with stock in scope." />
              </div>
              <div className="operations-panel flex flex-col gap-3 p-4">
                <h3 className="text-sm font-semibold">By category</h3>
                <DistributionBars rows={categoryRows} showValue={canViewValue} emptyMessage="No products with stock in scope." />
              </div>
            </section>
          ) : null}

          {canViewInventory && movementSummary ? (
            <section aria-labelledby="analytics-movement-heading" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="analytics-movement-heading" className="operations-heading text-base uppercase">Stock movement</h2>
                <div className="flex items-center gap-3">
                  <a href={`/api/analytics/export?type=movement&location=${scope.kind === 'location' ? scope.code : 'ALL'}&days=${movementDays}`} className="text-xs underline text-muted-foreground">Export CSV</a>
                  <form method="get" className="flex items-center gap-2 text-xs">
                    <input type="hidden" name="location" value={scope.kind === 'location' ? scope.code : 'ALL'} />
                    <input type="hidden" name="slowWindow" value={String(slowWindow)} />
                    <label htmlFor="movementDays" className="text-muted-foreground">Period</label>
                    <select id="movementDays" name="movementDays" defaultValue={String(movementDays)} className="h-9 rounded-md border border-input bg-background px-2">
                      {MOVEMENT_PERIODS.map((d) => <option key={d} value={d}>{d} days</option>)}
                    </select>
                    <button type="submit" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Apply</button>
                  </form>
                </div>
              </div>
              <div className="operations-panel p-4">
                <MovementBars summary={movementSummary} />
              </div>
              <MovementTables
                fastMoving={fastMoving}
                slowMoving={slowMoving}
                slowWindow={slowWindow}
                movementDays={movementDays}
                locationParam={scope.kind === 'location' ? scope.code : 'ALL'}
              />
            </section>
          ) : null}

          {canViewPurchasing ? (
            <section aria-labelledby="analytics-replenishment-heading" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="analytics-replenishment-heading" className="operations-heading text-base uppercase text-purchasing">Replenishment</h2>
                <div className="flex items-center gap-3">
                  <a href={`/api/analytics/export?type=replenishment&location=${scope.kind === 'location' ? scope.code : 'ALL'}`} className="text-xs underline text-muted-foreground">Export CSV</a>
                  <Link href="/purchasing/reorder" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Open smart reorder</Link>
                </div>
              </div>
              <ReplenishmentPreview suggestions={reorderSuggestions} />
            </section>
          ) : null}

          {purchasingCounts ? (
            <section aria-labelledby="analytics-purchasing-heading" className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 id="analytics-purchasing-heading" className="operations-heading text-base uppercase text-purchasing">Purchasing</h2>
                <Link href="/purchasing/purchase-orders" className="text-xs underline">View purchase orders</Link>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <MetricCard label="Pending approval" value={purchasingCounts.pendingApproval} icon={ShoppingCart} tone="warning" />
                <MetricCard label="Awaiting receipt" value={purchasingCounts.approvedAwaitingReceipt} icon={Truck} tone="neutral" />
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
