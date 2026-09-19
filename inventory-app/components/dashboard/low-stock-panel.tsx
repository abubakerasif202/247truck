import Link from 'next/link';
import { PackageX, TriangleAlert } from 'lucide-react';

import type { InventorySummaryRow } from '@/lib/inventory/queries';
import { formatTyreMeta } from '@/lib/format';
import { StockLevelBar } from '@/components/ui/stock-level-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';

export function LowStockPanel({
  rows,
  totalCount,
}: {
  rows: InventorySummaryRow[];
  totalCount: number;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Stock levels look healthy"
        description="No products are at or below their reorder threshold right now."
      />
    );
  }

  const overflow = totalCount - rows.length;

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => {
        const critical = row.onHand <= 0;
        return (
          <li key={`${row.productId}-${row.locationCode}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className={critical ? 'flex size-7 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger' : 'flex size-7 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning'}>
              {critical ? <PackageX className="size-4" /> : <TriangleAlert className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <Link href={`/inventory/${row.productId}`} className="block truncate text-sm font-medium hover:underline">
                {row.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {formatTyreMeta({ condition: row.tyreCondition, brand: row.brandName, pattern: row.patternName, size: row.sizeName })}
                {' · '}
                <span className="location-chip" data-location={row.locationCode}>{row.locationCode}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StockLevelBar onHand={row.onHand} minimumStock={row.minimumStock} />
              <StatusBadge tone={critical ? 'danger' : 'warning'}>{critical ? 'Out of stock' : 'Low stock'}</StatusBadge>
            </div>
          </li>
        );
      })}
      {overflow > 0 ? (
        <li className="pt-2.5 text-center text-xs">
          <Link href="/inventory?low=1" className="text-brand-deep-red underline underline-offset-2">
            +{overflow} more low-stock item{overflow === 1 ? '' : 's'}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
