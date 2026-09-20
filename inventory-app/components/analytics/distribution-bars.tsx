import { formatAudOrPending } from '@/lib/format';
import type { InventoryDistributionRow } from '@/lib/analytics/types';

/**
 * Horizontal bar list for a distribution (brand/size/category). Pure SVG-free
 * CSS bars, matching the project convention of hand-rolled charts (see
 * components/dashboard/stock-status-ring.tsx) since no chart library is a
 * dependency. Every bar carries its own numeric label, so the chart is
 * understandable without relying on relative bar length or hover.
 */
export function DistributionBars({
  rows,
  emptyMessage,
  showValue,
}: {
  rows: InventoryDistributionRow[];
  emptyMessage: string;
  showValue: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const maxOnHand = Math.max(...rows.map((r) => r.onHand), 1);

  return (
    <ul className="flex flex-col gap-2.5" role="list">
      {rows.map((row) => (
        <li key={row.groupLabel} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <span className="font-medium">{row.groupLabel}</span>
            <span className="text-xs text-muted-foreground">
              {row.productCount} product{row.productCount === 1 ? '' : 's'} · {row.onHand} on hand
              {row.lowStockCount > 0 ? ` · ${row.lowStockCount} low` : ''}
              {showValue ? ` · ${formatAudOrPending(row.knownInventoryValue)}` : ''}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            <div
              className="h-full rounded-full bg-inventory"
              style={{ width: `${Math.max(2, (row.onHand / maxOnHand) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
