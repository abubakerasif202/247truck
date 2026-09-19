import { cn } from '@/lib/utils';
import type { PurchaseOrderStatus } from '@/lib/purchasing/types';

type ReceiptProgressTone = 'empty' | 'partial' | 'complete' | 'closed';

function resolveTone(
  receivedQuantity: number,
  orderedQuantity: number,
  status?: PurchaseOrderStatus,
): ReceiptProgressTone {
  // A short-closed PO reads as neutral progress, never "success" — closed and
  // fully received are two different terminal states (see status-badge.tsx's
  // statusTone: 'closed' maps to the neutral tone, 'received' to success).
  if (status === 'closed') return 'closed';
  if (orderedQuantity > 0 && receivedQuantity >= orderedQuantity) return 'complete';
  if (receivedQuantity > 0) return 'partial';
  return 'empty';
}

const BAR_TONE: Record<ReceiptProgressTone, string> = {
  empty: 'bg-brand-steel/35',
  partial: 'bg-warning',
  complete: 'bg-success',
  closed: 'bg-brand-steel',
};

/**
 * Compact "Received X / Y units" indicator for a purchase order (or a single
 * order line). `receivedQuantity` / `orderedQuantity` must already be real
 * quantities from the server — summed across a PO's own lines, or a single
 * line's own values — this component only visualizes them, it never derives
 * its own totals from partial or aggregated data.
 */
export function ReceiptProgress({
  receivedQuantity,
  orderedQuantity,
  status,
  showLabel = true,
  className,
}: {
  receivedQuantity: number;
  orderedQuantity: number;
  status?: PurchaseOrderStatus;
  /** Set false to render just the bar — e.g. inside a MetricCard that already shows the numbers as its headline value. */
  showLabel?: boolean;
  className?: string;
}) {
  const pct =
    orderedQuantity > 0
      ? Math.max(0, Math.min(100, Math.round((receivedQuantity / orderedQuantity) * 100)))
      : 0;
  const tone = resolveTone(receivedQuantity, orderedQuantity, status);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Decorative bar is aria-hidden; the visible "X / Y units" text is the
          single accessible value, matching components/ui/stock-level-bar.tsx. */}
      <div
        aria-hidden="true"
        title={`${receivedQuantity} of ${orderedQuantity} units received`}
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-secondary"
      >
        <div className={cn('h-full rounded-full transition-[width]', BAR_TONE[tone])} style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? (
        <span className="metric-value text-xs tabular-nums text-muted-foreground">
          {receivedQuantity} / {orderedQuantity} units
        </span>
      ) : null}
    </div>
  );
}
