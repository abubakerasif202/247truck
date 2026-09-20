import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import type { FastMovingProduct, SlowMovingProduct } from '@/lib/analytics/types';

function formatLastMoved(row: SlowMovingProduct): string {
  if (row.neverMoved) return 'Never moved';
  if (row.daysSinceLastMovement === null) return '—';
  return `${row.daysSinceLastMovement} day${row.daysSinceLastMovement === 1 ? '' : 's'} ago`;
}

/**
 * Fast-moving and slow-moving product tables for the analytics period. Fast
 * moving is labelled "stock movement", not "top selling": the underlying
 * public.fast_moving_products RPC counts every outward movement_type
 * (stock_out, used_unit_out) regardless of whether the trigger was a POS
 * sale, a completed job, or a manual stock-out — see the RPC's own comment
 * in supabase/migrations/20260920100000_operations_analytics_rpcs.sql.
 */
export function MovementTables({
  fastMoving,
  slowMoving,
  slowWindow,
  movementDays,
  locationParam,
}: {
  fastMoving: FastMovingProduct[];
  slowMoving: SlowMovingProduct[];
  slowWindow: number;
  movementDays: number;
  locationParam: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="operations-panel flex flex-col gap-3 p-4">
        <h3 className="text-sm font-semibold">Fast-moving (last {movementDays} days)</h3>
        {fastMoving.length === 0 ? (
          <EmptyState title="No outward movement" description={`No stock-out activity in the last ${movementDays} days for this scope.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="operations-table w-full min-w-[520px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Branch</th>
                  <th className="px-3 py-2 text-right">Moved</th>
                  <th className="px-3 py-2 text-right">Movements</th>
                  <th className="px-3 py-2 text-right">On hand</th>
                </tr>
              </thead>
              <tbody>
                {fastMoving.map((row) => (
                  <tr key={`${row.productId}-${row.locationCode}`}>
                    <td className="px-3 py-2 font-medium">
                      {row.productName}
                      {row.brandName || row.sizeName ? (
                        <span className="block text-xs text-muted-foreground">
                          {[row.brandName, row.sizeName].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.locationCode}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{row.quantityMoved}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.movementCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.onHand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="operations-panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Slow-moving (inactive {slowWindow}+ days)</h3>
          <a href={`/api/analytics/export?type=slow-moving&location=${locationParam}&window=${slowWindow}`} className="text-xs underline text-muted-foreground">Export CSV</a>
          <form method="get" className="flex items-center gap-2 text-xs">
            <input type="hidden" name="location" value={locationParam} />
            <input type="hidden" name="movementDays" value={String(movementDays)} />
            <label htmlFor="slowWindow" className="text-muted-foreground">Window</label>
            <select
              id="slowWindow"
              name="slowWindow"
              defaultValue={String(slowWindow)}
              className="h-8 rounded-md border border-input bg-background px-2"
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            >
              {[30, 60, 90].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
            <noscript>
              <button type="submit" className="rounded-md border border-input px-2 py-1">Apply</button>
            </noscript>
          </form>
        </div>
        {slowMoving.length === 0 ? (
          <EmptyState title="Nothing slow-moving" description="Every product with stock has moved within the selected window." />
        ) : (
          <div className="overflow-x-auto">
            <table className="operations-table w-full min-w-[520px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left">Branch</th>
                  <th className="px-3 py-2 text-right">On hand</th>
                  <th className="px-3 py-2 text-left">Last outward movement</th>
                </tr>
              </thead>
              <tbody>
                {slowMoving.map((row) => (
                  <tr key={`${row.productId}-${row.locationCode}`}>
                    <td className="px-3 py-2 font-medium">
                      {row.productName}
                      {row.brandName || row.sizeName ? (
                        <span className="block text-xs text-muted-foreground">
                          {[row.brandName, row.sizeName].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.locationCode}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.onHand}</td>
                    <td className="px-3 py-2">
                      {row.neverMoved ? (
                        <StatusBadge tone="warning">Never moved</StatusBadge>
                      ) : (
                        <span className="text-muted-foreground">{formatLastMoved(row)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
