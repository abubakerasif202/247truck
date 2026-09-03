import Link from 'next/link';

import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { LOCATION_NAMES } from '@/lib/app-config';
import { formatAud } from '@/lib/format';
import { getDashboardInventoryMetrics } from '@/lib/inventory/queries';
import { getPurchasingDashboardCounts } from '@/lib/purchasing/queries';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {access.role === 'admin' ? 'Admin' : 'Manager'} · {scopeLabel}
        </p>
      </header>

      {!metrics ? (
        <p className="text-sm text-destructive">Could not load metrics. Please refresh.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Active products" value={String(metrics.activeProducts)} />
            <Metric label="Total on hand" value={String(metrics.totalOnHand)} />
            <Metric
              label="Low-stock items"
              value={String(metrics.lowStockItems)}
              accent={metrics.lowStockItems > 0}
            />
            <Metric
              label="Inventory value"
              value={
                metrics.inventoryValue === null
                  ? '—'
                  : formatAud(metrics.inventoryValue)
              }
            />
          </dl>

          <section className="flex flex-col gap-2">
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
                      className={
                        m.quantityDelta < 0 ? 'text-destructive' : 'text-emerald-700'
                      }
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
            <section className="flex flex-col gap-2" aria-labelledby="purchasing-status-heading">
              <div className="flex items-center justify-between">
                <h2 id="purchasing-status-heading" className="text-sm font-semibold">
                  Purchasing
                </h2>
                <Link href="/purchasing/purchase-orders" className="text-xs underline">
                  View purchase orders
                </Link>
              </div>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Link
                  href="/purchasing/purchase-orders?status=submitted"
                  className="rounded-lg border border-border bg-card p-4 hover:bg-secondary/40"
                >
                  <dt className="text-xs text-muted-foreground">Pending approval</dt>
                  <dd className="mt-1 text-xl font-semibold">{purchasingCounts.pendingApproval}</dd>
                </Link>
                <Link
                  href="/purchasing/purchase-orders"
                  className="rounded-lg border border-border bg-card p-4 hover:bg-secondary/40"
                >
                  <dt className="text-xs text-muted-foreground">Awaiting receipt</dt>
                  <dd className="mt-1 text-xl font-semibold">
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

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        accent ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'
      }`}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
    </div>
  );
}
