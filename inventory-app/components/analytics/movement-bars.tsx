import type { StockMovementSummary } from '@/lib/analytics/types';

const SERIES = [
  { key: 'stockInUnits', label: 'Stock in', colorVar: 'var(--success)' },
  { key: 'stockOutUnits', label: 'Stock out', colorVar: 'var(--brand-deep-red)' },
  { key: 'adjustmentUnits', label: 'Adjustments', colorVar: 'var(--warning)' },
] as const;

/**
 * Comparative bar chart for stock-in / stock-out / adjustment unit totals over
 * a period. Every bar has a printed number, so the chart carries no
 * information a screen reader or colour-blind viewer would miss.
 */
export function MovementBars({ summary }: { summary: StockMovementSummary }) {
  const max = Math.max(summary.stockInUnits, summary.stockOutUnits, summary.adjustmentUnits, 1);

  return (
    <div className="flex flex-col gap-2.5" role="img" aria-label={`Last ${summary.periodDays} days: ${summary.stockInUnits} units in, ${summary.stockOutUnits} units out, ${summary.adjustmentUnits} units adjusted`}>
      {SERIES.map((series) => {
        const value = summary[series.key];
        return (
          <div key={series.key} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{series.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (value / max) * 100)}%`, backgroundColor: series.colorVar }}
              />
            </div>
            <span className="metric-value w-14 shrink-0 text-right text-sm tabular-nums">{value}</span>
          </div>
        );
      })}
    </div>
  );
}
