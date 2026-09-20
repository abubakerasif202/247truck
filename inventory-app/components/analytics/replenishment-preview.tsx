import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ReorderSuggestion } from '@/lib/purchasing/types';

/**
 * Read-only replenishment report. Deliberately reuses listReorderSuggestions
 * (public.reorder_suggestions) rather than recomputing shortage math —
 * that RPC already compares (available + on_order) against minimum_stock, so
 * this preview can never disagree with what /purchasing/reorder offers to
 * order. Creating draft POs stays on that page; this is reporting only.
 */
export function ReplenishmentPreview({
  suggestions,
}: {
  suggestions: ReorderSuggestion[];
}) {
  if (suggestions.length === 0) {
    return <EmptyState title="Nothing to reorder" description="Every product in scope is at or above its minimum stock, accounting for units already on order." />;
  }

  return (
    <div className="operations-panel overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 font-medium">Branch</th>
            <th className="px-4 py-2 text-right font-medium">Available</th>
            <th className="px-4 py-2 text-right font-medium">On order</th>
            <th className="px-4 py-2 text-right font-medium">Minimum</th>
            <th className="px-4 py-2 text-right font-medium">Remaining shortage</th>
            <th className="px-4 py-2 font-medium">Preferred supplier</th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((row) => {
            const shortage = Math.max(0, row.minimumStock - row.available - row.onOrder);
            return (
              <tr key={`${row.productId}-${row.locationCode}`} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2 font-medium">{row.productName}</td>
                <td className="px-4 py-2 text-muted-foreground">{row.locationCode}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.available}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.onOrder}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.minimumStock}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">{shortage}</td>
                <td className="px-4 py-2">
                  {row.preferredSupplierName ? (
                    <StatusBadge tone="neutral">{row.preferredSupplierName}</StatusBadge>
                  ) : (
                    <span className="text-xs text-muted-foreground">No preferred supplier</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
