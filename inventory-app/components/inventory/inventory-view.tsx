import Link from 'next/link';

import { formatAud, formatAudOrPending, formatTyreMeta } from '@/lib/format';
import type { InventorySummaryRow } from '@/lib/inventory/queries';
import type { LocationScope } from '@/lib/location/scope';
import { PRODUCT_CATEGORY_LABELS } from '@/lib/products/types';
import { StatusBadge } from '@/components/ui/status-badge';

type ProductGroup = {
  productId: string;
  name: string;
  meta: string;
  sellingPriceInclGst: number | null;
  byLocation: Map<string, InventorySummaryRow>;
  anyLow: boolean;
};

function group(rows: InventorySummaryRow[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const row of rows) {
    let g = map.get(row.productId);
    if (!g) {
      g = {
        productId: row.productId,
        name: row.name,
        meta: `${PRODUCT_CATEGORY_LABELS[row.categoryCode]} · ${formatTyreMeta({
          condition: row.tyreCondition,
          brand: row.brandName,
          pattern: row.patternName,
          size: row.sizeName,
        })}`,
        sellingPriceInclGst: row.sellingPriceInclGst,
        byLocation: new Map(),
        anyLow: false,
      };
      map.set(row.productId, g);
    }
    g.byLocation.set(row.locationCode, row);
    if (row.lowStock) g.anyLow = true;
  }
  return [...map.values()];
}

function PriceValue({ price }: { price: number | null }) {
  return price == null ? (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span>—</span>
      <StatusBadge tone="warning">Price Pending</StatusBadge>
    </span>
  ) : (
    <>{formatAudOrPending(price)}</>
  );
}

function CostValue({ row }: { row: InventorySummaryRow | undefined }) {
  if (!row) return <>—</>;
  if (row.onHand > 0 && row.weightedAverageCost == null) {
    return <StatusBadge tone="warning">Cost Pending</StatusBadge>;
  }
  if (row.weightedAverageCost != null) return <>{formatAud(row.weightedAverageCost)}</>;
  return <>—</>;
}

export function InventoryView({
  rows,
  scope,
  canViewCost,
}: {
  rows: InventorySummaryRow[];
  scope: LocationScope;
  canViewCost: boolean;
}) {
  const groups = group(rows);
  const isAll = scope.kind === 'all';
  const showWac = canViewCost && !isAll;

  if (groups.length === 0) {
    return (
      <div className="operations-panel border-dashed p-8 text-center"><div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-inventory-soft font-display text-inventory">24/7</div><p className="font-medium">No inventory matches these filters</p><p className="mt-1 text-sm text-muted-foreground">Adjust the filters to view stock records.</p></div>
    );
  }

  return (
    <>
      <div className="operations-panel hidden overflow-x-auto md:block">
        <table className="operations-table w-full text-sm">
          <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              {isAll ? (
                <>
                  <th className="px-3 py-2 text-right font-medium">Lonsdale</th>
                  <th className="px-3 py-2 text-right font-medium">Regency Park</th>
                </>
              ) : (
                <th className="px-3 py-2 text-right font-medium">Available</th>
              )}
              <th className="px-3 py-2 text-right font-medium">Sell price</th>
              {showWac ? <th className="px-3 py-2 text-right font-medium">WAC</th> : null}
              <th className="px-3 py-2 font-medium">Low stock</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const lon = g.byLocation.get('LON');
              const reg = g.byLocation.get('REG');
              const only = [...g.byLocation.values()][0];
              return (
                <tr key={g.productId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link href={`/inventory/${g.productId}`} className="font-medium underline-offset-2 hover:underline">
                      {g.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{g.meta}</p>
                  </td>
                  {isAll ? (
                    <>
                      <td className="px-3 py-2 text-right">{lon?.available ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{reg?.available ?? '—'}</td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-right">{only?.available ?? '—'}</td>
                  )}
                  <td className="px-3 py-2 text-right"><PriceValue price={g.sellingPriceInclGst} /></td>
                  {showWac ? <td className="px-3 py-2 text-right"><CostValue row={only} /></td> : null}
                  <td className="px-3 py-2">
                    {g.anyLow ? (
                      <StatusBadge status="low stock">Low stock</StatusBadge>
                    ) : (
                      <span className="text-xs text-muted-foreground">OK</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {groups.map((g) => {
          const locationRows = [...g.byLocation.values()];
          const only = locationRows[0];
          return (
            <li key={g.productId} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/inventory/${g.productId}`} className="font-medium underline-offset-2 hover:underline">
                  {g.name}
                </Link>
                {g.anyLow ? <StatusBadge status="low stock">Low stock</StatusBadge> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{g.meta}</p>
              <div className="mt-2 flex flex-col gap-1 text-sm">
                <span>{locationRows.map((r) => `${r.locationCode} ${r.available}`).join(' · ')}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Sell:</span>
                  <PriceValue price={g.sellingPriceInclGst} />
                </span>
                {showWac ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">WAC:</span>
                    <CostValue row={only} />
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
