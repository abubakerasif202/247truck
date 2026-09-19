import { cn } from '@/lib/utils';

/**
 * Compact inline stock-level indicator. `minimumStock` is the reorder
 * threshold already computed server-side (lib/inventory) — this component
 * only visualizes it, it never derives its own threshold.
 */
export function StockLevelBar({
  onHand,
  minimumStock,
  suffix,
  className,
}: {
  onHand: number;
  minimumStock: number;
  /** Optional trailing word after the number, e.g. "available" — appended to the same text node. */
  suffix?: string;
  className?: string;
}) {
  // Scale against 2x the reorder point so "healthy" stock doesn't clip the bar at 100%.
  const ceiling = Math.max(minimumStock * 2, minimumStock + 1, 1);
  const pct = Math.max(0, Math.min(100, Math.round((onHand / ceiling) * 100)));
  const tone = onHand <= 0 ? 'bg-danger' : onHand <= minimumStock ? 'bg-warning' : 'bg-success';

  return (
    // Decorative bar is aria-hidden; the visible number is the single accessible
    // value for this row so screen readers don't announce the quantity twice.
    <div className={cn('flex items-center gap-2', className)}>
      <div aria-hidden="true" title={`Reorder at ${minimumStock}`} className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="metric-value text-xs tabular-nums text-muted-foreground">
        {onHand}
        {suffix ? ` ${suffix}` : ''}
      </span>
    </div>
  );
}
