import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { getInventoryReconciliation } from '@/lib/inventory/reconciliation';

export const metadata = { title: 'Inventory Reconciliation' };

const STATUS_LABEL: Record<string, string> = {
  matched: 'Matched',
  overstated: 'Overstated',
  understated: 'Understated',
};

export default async function InventoryReconciliationPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    redirect('/dashboard');
  }

  const result = await getInventoryReconciliation();
  const mismatches = result.ok ? result.data.filter((row) => row.status !== 'matched') : [];

  return (
    <div className="operations-page max-w-6xl">
      <PageHeader
        title="Inventory Reconciliation"
        subtitle="Read-only comparison of stored stock against the inventory movement ledger. This report never changes stock — it only surfaces discrepancies for investigation."
      />

      {!result.ok ? (
        <div className="rounded-xl border border-destructive/40 p-8 text-sm text-destructive" role="alert">
          {result.error}
        </div>
      ) : mismatches.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
          No discrepancies found. Stored stock matches the movement ledger for every product and branch
          ({result.data.length} product/branch combinations checked).
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-destructive">
            {mismatches.length} discrepanc{mismatches.length === 1 ? 'y' : 'ies'} found out of {result.data.length}{' '}
            product/branch combinations. Investigate before trusting reports for the affected products.
          </p>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">Product</th>
                  <th scope="col" className="px-4 py-3">Branch</th>
                  <th scope="col" className="px-4 py-3 text-right">Stored qty</th>
                  <th scope="col" className="px-4 py-3 text-right">Ledger qty</th>
                  <th scope="col" className="px-4 py-3 text-right">Variance</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {mismatches.map((row) => (
                  <tr key={`${row.productId}-${row.locationId}`} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.productName}</div>
                      {row.partReference ? (
                        <div className="text-xs text-muted-foreground">{row.partReference}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{row.locationName} ({row.locationCode})</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.storedQuantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.ledgerQuantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.variance > 0 ? `+${row.variance}` : row.variance}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone="danger">{STATUS_LABEL[row.status] ?? row.status}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
