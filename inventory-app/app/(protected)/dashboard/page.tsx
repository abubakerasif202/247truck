import Link from 'next/link';

import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { LOCATION_NAMES } from '@/lib/app-config';
import { formatAud } from '@/lib/format';
import { getDashboardInventoryMetrics } from '@/lib/inventory/queries';
import { getPurchasingDashboardCounts } from '@/lib/purchasing/queries';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';

export default async function DashboardPage() {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();

  const scopeLabel = scope.kind === 'all' ? 'All Locations' : LOCATION_NAMES[scope.code];

  let metrics;
  try {
    metrics = await getDashboardInventoryMetrics(supabase, access, scope);
  } catch {
    metrics = null;
  }

  let purchasingCounts = null;
  if (hasPermission(access, 'purchasing.view')) {
    try {
      purchasingCounts = await getPurchasingDashboardCounts(supabase, access, scope);
    } catch {
      purchasingCounts = null;
    }
  }

  return (
    <div className="operations-page max-w-5xl">
      <PageHeader title="Operations dashboard" subtitle={`${access.role === 'admin' ? 'Admin' : 'Manager'} · ${scopeLabel} · Live stock overview`} />

      {!metrics ? (
        <p className="text-sm text-destructive">Could not load metrics. Please refresh.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Active products" value={String(metrics.activeProducts)} tone="inventory" />
            <Metric label="Total on hand" value={String(metrics.totalOnHand)} tone="inventory" />
            <Metric
              label="Low-stock items"
              value={String(metrics.lowStockItems)}
              tone={metrics.lowStockItems > 0 ? 'warning' : 'neutral'}
            />
            <Metric
              label="Inventory value"
              value={
                metrics.inventoryValue === null
                  ? '—'
                  : formatAud(metrics.inventoryValue)
              }
              tone="brand"
            />
          </dl>

          <section className="operations-panel flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Recent stock movements</h2>
              <Link href="/inventory?low=1" className="text-xs underline">
                View low stock
              </Link>
            </div>
            {metrics.recentMovements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movements yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {metrics.recentMovements.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
                  >
                    <span>
                      {m.productName}{' '}
                      <span className="text-xs text-muted-foreground">
                        {m.locationCode} · {m.movementType}
                      </span>
                    </span>
                    <span
                      className={m.quantityDelta < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}
                    >
                      {m.quantityDelta > 0 ? '+' : ''}
                      {m.quantityDelta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Link
                  href="/purchasing/purchase-orders?status=submitted"
                  className="operations-panel border-t-2 border-t-purchasing p-4 transition hover:bg-purchasing-soft"
                >
                  <dt className="text-xs text-muted-foreground">Pending approval</dt>
                  <dd className="metric-value mt-1 text-3xl text-purchasing">{purchasingCounts.pendingApproval}</dd>
                </Link>
                <Link
                  href="/purchasing/purchase-orders"
                  className="operations-panel border-t-2 border-t-receiving p-4 transition hover:bg-receiving-soft"
                >
                  <dt className="text-xs text-muted-foreground">Awaiting receipt</dt>
                  <dd className="metric-value mt-1 text-3xl text-receiving">
                    {purchasingCounts.approvedAwaitingReceipt}
                  </dd>
                </Link>
              </dl>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'inventory' | 'warning' | 'brand' | 'neutral' }) {
  const toneClass = { inventory: 'border-t-inventory bg-inventory-soft/40', warning: 'border-t-warning bg-warning-soft/50', brand: 'border-t-brand-red bg-brand-red-soft/45', neutral: 'border-t-brand-steel' }[tone];
  return (
    <div className={`operations-panel border-t-2 p-4 ${toneClass}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="metric-value mt-1 text-3xl">{value}</dd>
    </div>
  );
}
