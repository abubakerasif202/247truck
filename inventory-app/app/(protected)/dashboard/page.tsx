import Link from 'next/link';
import { Banknote, Boxes, Clock, PackageX, ShoppingCart, Truck, TriangleAlert, Warehouse } from 'lucide-react';

import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { LOCATION_NAMES } from '@/lib/app-config';
import { formatAudOrPending } from '@/lib/format';
import { getDashboardInventoryMetrics, searchInventory } from '@/lib/inventory/queries';
import { getPurchasingDashboardCounts } from '@/lib/purchasing/queries';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { EmptyState } from '@/components/ui/empty-state';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { StockStatusRing } from '@/components/dashboard/stock-status-ring';
import { LowStockPanel } from '@/components/dashboard/low-stock-panel';
import { RecentActivity } from '@/components/dashboard/recent-activity';

export default async function DashboardPage() {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();

  const scopeLabel = scope.kind === 'all' ? 'All Locations' : LOCATION_NAMES[scope.code];
  const canViewPurchasing = hasPermission(access, 'purchasing.view');
  const canViewInventory = hasPermission(access, 'inventory.view');

  const [metrics, purchasingCounts, lowStockPage] = await Promise.all([
    canViewInventory
      ? getDashboardInventoryMetrics(supabase, access, scope).catch(() => null)
      : Promise.resolve(null),
    canViewPurchasing
      ? getPurchasingDashboardCounts(supabase, access, scope).catch(() => null)
      : Promise.resolve(null),
    // Capped at the API's max page size (200) — see components/dashboard/low-stock-panel.tsx
    // for how the rare >200-low-stock-items overflow is surfaced rather than hidden.
    canViewInventory
      ? searchInventory(supabase, access, { scope, lowStockOnly: true, limit: 200 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const lowStockRows = lowStockPage?.rows ?? [];
  const outOfStock = lowStockRows.filter((r) => r.onHand <= 0).length;
  const lowNotOut = lowStockRows.length - outOfStock;
  const healthy = metrics ? Math.max(0, metrics.activeProducts - metrics.lowStockItems) : 0;

  return (
    <div className="operations-page max-w-6xl">
      <PageHeader
        title="Operations dashboard"
        subtitle={`${access.role === 'admin' ? 'Admin' : 'Manager'} · ${scopeLabel} · Live stock overview`}
      />

      <QuickActions access={access} />

      {!canViewInventory ? (
        <EmptyState title="Stock metrics unavailable" description="Viewing this dashboard's stock metrics requires the View stock permission." />
      ) : !metrics ? (
        <EmptyState tone="error" title="Unable to load inventory metrics" description="We couldn't load the inventory data right now. Refresh the page to try again." />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard label="Active products" value={metrics.activeProducts} icon={Boxes} tone="inventory" />
            <MetricCard label="Total on hand" value={metrics.totalOnHand} caption="units across locations" icon={Warehouse} tone="inventory" />
            <MetricCard
              label="Low-stock items"
              value={metrics.lowStockItems}
              caption={metrics.lowStockItems > 0 ? 'at or below reorder point' : 'all above reorder point'}
              icon={TriangleAlert}
              tone={metrics.lowStockItems > 0 ? 'warning' : 'success'}
            />
            <MetricCard label="Known inventory value" value={formatAudOrPending(metrics.inventoryValue)} icon={Banknote} tone="brand" />
            <MetricCard
              label="Unvalued stock"
              value={metrics.unvaluedUnits === null ? '—' : `${metrics.unvaluedUnits}`}
              caption={metrics.unvaluedUnits === null ? undefined : 'units without a known cost'}
              icon={PackageX}
              tone={metrics.unvaluedUnits && metrics.unvaluedUnits > 0 ? 'warning' : 'neutral'}
            />
          </dl>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <section className="operations-panel flex flex-col gap-4 p-4 lg:col-span-2">
              <h2 className="text-sm font-semibold">Stock health</h2>
              <StockStatusRing healthy={healthy} low={lowNotOut} out={outOfStock} />
              {lowStockPage && metrics.lowStockItems > lowStockPage.rows.length ? (
                <p className="text-[11px] text-muted-foreground">Showing the first {lowStockPage.rows.length} of {metrics.lowStockItems} low-stock items.</p>
              ) : null}
            </section>

            <section className="operations-panel flex flex-col gap-3 p-4 lg:col-span-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Needs attention</h2>
                <Link href="/inventory?low=1" className="text-xs text-brand-deep-red underline underline-offset-2">
                  View all low stock
                </Link>
              </div>
              <LowStockPanel rows={lowStockRows.slice(0, 6)} totalCount={metrics.lowStockItems} />
            </section>
          </div>

          <section className="operations-panel flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Recent activity</h2>
            </div>
            <RecentActivity movements={metrics.recentMovements} />
          </section>

          {purchasingCounts ? (
            <section className="flex flex-col gap-3" aria-labelledby="purchasing-status-heading">
              <div className="flex items-center justify-between">
                <h2 id="purchasing-status-heading" className="operations-heading text-base uppercase text-purchasing">
                  Purchasing
                </h2>
                <Link href="/purchasing/purchase-orders" className="text-xs underline">
                  View purchase orders
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Link
                  href="/purchasing/purchase-orders?status=submitted"
                  className="operations-panel flex items-center gap-3 border-t-2 border-t-purchasing p-4 transition hover:bg-purchasing-soft"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-purchasing-soft text-purchasing">
                    <ShoppingCart className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs text-muted-foreground">Pending approval</span>
                    <span className="block metric-value mt-0.5 text-3xl text-purchasing">{purchasingCounts.pendingApproval}</span>
                  </span>
                </Link>
                <Link
                  href="/purchasing/purchase-orders"
                  className="operations-panel flex items-center gap-3 border-t-2 border-t-receiving p-4 transition hover:bg-receiving-soft"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-receiving-soft text-receiving">
                    <Truck className="size-4" />
                  </span>
                  <span>
                    <span className="block text-xs text-muted-foreground">Awaiting receipt</span>
                    <span className="block metric-value mt-0.5 text-3xl text-receiving">{purchasingCounts.approvedAwaitingReceipt}</span>
                  </span>
                </Link>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
