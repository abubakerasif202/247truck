import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { getAdelaideMappingHealth, getAdelaideReconciliation, getInventoryReconciliation } from '@/lib/inventory/reconciliation';
import { recoverPaidOrderAction } from './actions';

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

  const [result, websiteResult, mappingResult] = await Promise.all([
    getInventoryReconciliation(),
    getAdelaideReconciliation(),
    getAdelaideMappingHealth(),
  ]);
  const mismatches = result.ok ? result.data.filter((row) => row.status !== 'matched') : [];

  return (
    <div className="operations-page max-w-6xl domain-settings">
      <PageHeader
        domain="settings"
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

          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="operations-table w-full min-w-[720px] text-left text-sm">
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

          <ul className="flex flex-col gap-2.5 md:hidden">
            {mismatches.map((row) => (
              <li key={`${row.productId}-${row.locationId}`} className="operations-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{row.productName}</p>
                    {row.partReference ? (
                      <p className="text-xs text-muted-foreground">{row.partReference}</p>
                    ) : null}
                  </div>
                  <StatusBadge tone="danger">{STATUS_LABEL[row.status] ?? row.status}</StatusBadge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{row.locationName} ({row.locationCode})</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Stored</dt><dd className="tabular-nums">{row.storedQuantity}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Ledger</dt><dd className="tabular-nums">{row.ledgerQuantity}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Variance</dt><dd className="tabular-nums">{row.variance > 0 ? `+${row.variance}` : row.variance}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      <section className="mt-10 space-y-4" aria-labelledby="website-reconciliation-heading">
        <h2 id="website-reconciliation-heading" className="text-base font-semibold">Website order reconciliation</h2>
        {!websiteResult.ok ? (
          <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive" role="alert">{websiteResult.error}</p>
        ) : websiteResult.data.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No cross-system discrepancies found.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
              <table className="operations-table w-full min-w-[900px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
                  <th className="px-4 py-3">Severity</th><th className="px-4 py-3">Issue</th><th className="px-4 py-3">Identifiers</th>
                  <th className="px-4 py-3">Expected / actual</th><th className="px-4 py-3">Safe guidance</th><th className="px-4 py-3">Recovery</th>
                </tr></thead>
                <tbody>{websiteResult.data.map((row, index) => <tr key={`${row.discrepancyType}-${row.reservationId ?? row.mappingId ?? index}`} className="border-b align-top last:border-0">
                  <td className="px-4 py-3"><StatusBadge tone={row.severity === 'critical' ? 'danger' : 'warning'}>{row.severity}</StatusBadge></td>
                  <td className="px-4 py-3 font-medium">{row.discrepancyType.replaceAll('_', ' ')}</td>
                  <td className="px-4 py-3 font-mono text-xs">{[row.externalOrderReference, row.reservationId, row.mappingId, row.inventoryProductId, row.requestId].filter(Boolean).join(' · ')}</td>
                  <td className="px-4 py-3 tabular-nums">{row.expectedQuantity ?? '—'} / {row.actualQuantity ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.guidance}</td>
                  <td className="px-4 py-3">{row.discrepancyType === 'paid_without_committed_inventory' && row.externalOrderReference ? <form action={recoverPaidOrderAction}>
                    <input type="hidden" name="orderReference" value={row.externalOrderReference} /><button className="rounded-md border px-3 py-2 text-xs font-medium" type="submit">Retry commit</button>
                  </form> : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>

            <ul className="flex flex-col gap-2.5 md:hidden">
              {websiteResult.data.map((row, index) => (
                <li key={`${row.discrepancyType}-${row.reservationId ?? row.mappingId ?? index}`} className="operations-panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">{row.discrepancyType.replaceAll('_', ' ')}</p>
                    <StatusBadge tone={row.severity === 'critical' ? 'danger' : 'warning'}>{row.severity}</StatusBadge>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {[row.externalOrderReference, row.reservationId, row.mappingId, row.inventoryProductId, row.requestId].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-2 text-sm tabular-nums">Expected / actual: {row.expectedQuantity ?? '—'} / {row.actualQuantity ?? '—'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{row.guidance}</p>
                  {row.discrepancyType === 'paid_without_committed_inventory' && row.externalOrderReference ? (
                    <form action={recoverPaidOrderAction} className="mt-2">
                      <input type="hidden" name="orderReference" value={row.externalOrderReference} />
                      <button className="rounded-md border px-3 py-2 text-xs font-medium" type="submit">Retry commit</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mt-10 space-y-4" aria-labelledby="mapping-health-heading">
        <h2 id="mapping-health-heading" className="text-base font-semibold">Website product mapping health</h2>
        {!mappingResult.ok ? <p className="text-sm text-destructive" role="alert">{mappingResult.error}</p> : <>
          <p className="text-sm text-muted-foreground">{mappingResult.data.filter((row) => row.status === 'valid').length} valid; {mappingResult.data.filter((row) => row.status !== 'valid').length} invalid.</p>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block"><table className="operations-table w-full min-w-[760px] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Website product</th><th className="px-4 py-3">Mapping ID</th><th className="px-4 py-3">Inventory product</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>{mappingResult.data.map((row) => <tr key={row.websiteProductId} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{row.websiteProductId}</td><td className="px-4 py-3 font-mono text-xs">{row.mappingId ?? '—'}</td><td className="px-4 py-3 font-mono text-xs">{row.inventoryProductId ?? '—'}</td><td className="px-4 py-3"><StatusBadge tone={row.status === 'valid' ? 'success' : 'danger'}>{row.issue ?? row.status}</StatusBadge></td></tr>)}</tbody>
          </table></div>

          <ul className="flex flex-col gap-2.5 md:hidden">
            {mappingResult.data.map((row) => (
              <li key={row.websiteProductId} className="operations-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium">{row.websiteProductId}</p>
                  <StatusBadge tone={row.status === 'valid' ? 'success' : 'danger'}>{row.issue ?? row.status}</StatusBadge>
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">Mapping: {row.mappingId ?? '—'}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">Inventory product: {row.inventoryProductId ?? '—'}</p>
              </li>
            ))}
          </ul>
        </>}
      </section>
    </div>
  );
}
