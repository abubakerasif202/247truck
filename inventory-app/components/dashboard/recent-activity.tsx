import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  PackageMinus,
  PackagePlus,
  RotateCcw,
  SlidersHorizontal,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import type { RecentMovement } from '@/lib/inventory/queries';
import { formatRelativeTime } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';

const MOVEMENT_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  quick_stock_in: { label: 'Stock received', icon: PackagePlus, tone: 'bg-success-soft text-success' },
  stock_out: { label: 'Stock issued', icon: PackageMinus, tone: 'bg-secondary text-brand-charcoal' },
  adjustment: { label: 'Stock adjusted', icon: SlidersHorizontal, tone: 'bg-warning-soft text-warning' },
  used_unit_in: { label: 'Used tyre received', icon: PackagePlus, tone: 'bg-used-tyre-soft text-used-tyre' },
  used_unit_out: { label: 'Used tyre issued', icon: PackageMinus, tone: 'bg-used-tyre-soft text-used-tyre' },
  purchase_receipt: { label: 'Purchase received', icon: Truck, tone: 'bg-receiving-soft text-receiving' },
  opening_stock: { label: 'Opening stock', icon: Boxes, tone: 'bg-inventory-soft text-inventory' },
  transfer_in: { label: 'Transferred in', icon: ArrowDownRight, tone: 'bg-info-soft text-info' },
  transfer_out: { label: 'Transferred out', icon: ArrowUpRight, tone: 'bg-info-soft text-info' },
  customer_return: { label: 'Customer return', icon: RotateCcw, tone: 'bg-info-soft text-info' },
};

const FALLBACK_META = { label: 'Stock movement', icon: SlidersHorizontal, tone: 'bg-secondary text-brand-charcoal' };

export function RecentActivity({ movements }: { movements: RecentMovement[] }) {
  if (movements.length === 0) {
    return <EmptyState title="No stock movements yet" description="Activity from stock in, stock out, purchasing and transfers will appear here." />;
  }

  return (
    <ol className="flex flex-col gap-0">
      {movements.map((m, i) => {
        const meta = MOVEMENT_META[m.movementType] ?? FALLBACK_META;
        const Icon = meta.icon;
        const isLast = i === movements.length - 1;
        return (
          <li key={m.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast ? <span aria-hidden="true" className="absolute top-8 left-[15px] h-[calc(100%-1.75rem)] w-px bg-border" /> : null}
            <span className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium">
                  {meta.label} <span className="font-normal text-muted-foreground">· {m.productName}</span>
                </p>
                <span className={m.quantityDelta < 0 ? 'metric-value text-sm font-semibold text-danger' : 'metric-value text-sm font-semibold text-success'}>
                  {m.quantityDelta > 0 ? '+' : ''}
                  {m.quantityDelta}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="location-chip mr-1.5 align-middle" data-location={m.locationCode}>{m.locationCode}</span>
                {formatRelativeTime(m.createdAt)}
              </p>
              {m.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{m.notes}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
