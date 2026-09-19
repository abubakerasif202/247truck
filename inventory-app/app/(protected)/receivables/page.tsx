import Link from 'next/link';
import { AlertTriangle, Search } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { formatAud } from '@/lib/format';
import { listReceivables } from '@/lib/finance/queries';
import { describeLocationScope, getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Receivables' };

type Params = { state?: string; search?: string; cursor_due?: string; cursor_id?: string };

function href(params: Params, change: Partial<Params>) {
  const merged: Params = { ...params, ...change };
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) result.set(key, value);
  const query = result.toString();
  return `/receivables${query ? `?${query}` : ''}`;
}

export default async function ReceivablesPage({
  searchParams,
}: { searchParams: Promise<Params> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'receivables.view')) {
    return (
      <div className="operations-page max-w-6xl domain-receivables">
        <PageHeader domain="receivables" title="Receivables" subtitle="Permission denied" />
      </div>
    );
  }
  const params = await searchParams;
  const { state, search, cursor_due: cursorDue, cursor_id: cursorId } = params;
  const scope = await getCurrentLocationScope(access);
  const locationId = await getCurrentScopeLocationId(access, scope);
  const scopeLabel = describeLocationScope(scope);
  const hasCursor = Boolean(cursorId);
  const result = await listReceivables({
    state: state ?? null,
    search: search ?? null,
    locationId,
    cursorDueDate: cursorId ? (cursorDue ?? null) : null,
    cursorInvoiceId: cursorId ?? null,
  });
  const showLocation = scope.kind === 'all';

  return (
    <div className="operations-page max-w-6xl domain-receivables">
      <PageHeader domain="receivables" title="Receivables" subtitle={`Issued invoice balances by due date · ${scopeLabel}`} />

      <form className="operations-panel flex flex-wrap items-center gap-3 p-4" role="search" method="get" noValidate>
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm"
          name="search"
          aria-label="Search receivables"
          defaultValue={search ?? ''}
          placeholder="Search invoice or customer"
        />
        <select
          className="h-10 rounded-md border border-input bg-card px-3 text-sm"
          name="state"
          aria-label="Receivable state"
          defaultValue={state ?? ''}
        >
          <option value="">All outstanding</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid (history)</option>
        </select>
        <button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm" type="submit">
          Filter
        </button>
      </form>

      {!result.ok ? (
        <EmptyState
          tone="error"
          title="Unable to load receivables"
          description={result.error}
          action={
            <Link className="text-sm text-primary underline" href={href(params, {})}>
              Retry
            </Link>
          }
        />
      ) : result.data.length === 0 ? (
        <EmptyState title="No matching receivables" description="Adjust the search or state filter to see more results." />
      ) : (
        <>
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Due date</th>
                  <th className="px-3 py-2 text-right font-medium">Outstanding balance</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((row) => (
                  <tr
                    key={row.invoice_id}
                    data-testid={`receivable-row-${row.invoice_id}`}
                    className={cn('border-t border-border', row.is_overdue && 'bg-danger-soft/25')}
                  >
                    <td className="px-3 py-2">
                      {row.invoice_link_allowed ? (
                        <Link href={`/invoices/${row.invoice_id}`} prefetch={false} className="font-medium underline-offset-2 hover:underline">
                          {row.invoice_number}
                        </Link>
                      ) : (
                        <span className="font-medium">{row.invoice_number}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.customer_name}
                      {showLocation ? ` · ${row.location_code}` : ''}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.due_date ?? 'on receipt'}
                      <span className="block text-xs text-muted-foreground/80">{row.aging_bucket.replace('_', ' ')}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatAud(Number(row.balance))}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.is_overdue ? 'overdue' : row.payment_state} className="inline-flex items-center gap-1">
                        {row.is_overdue ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : null}
                        {row.is_overdue ? 'Overdue' : row.payment_state}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2.5 md:hidden">
            {result.data.map((row) => (
              <li
                key={row.invoice_id}
                data-testid={`receivable-row-${row.invoice_id}`}
                className={cn('rounded-lg border border-border bg-card p-4', row.is_overdue && 'bg-danger-soft/25')}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {row.invoice_link_allowed ? (
                    <Link href={`/invoices/${row.invoice_id}`} prefetch={false} className="font-semibold underline-offset-2 hover:underline">
                      {row.invoice_number}
                    </Link>
                  ) : (
                    <span className="font-semibold">{row.invoice_number}</span>
                  )}
                  <StatusBadge status={row.is_overdue ? 'overdue' : row.payment_state} className="inline-flex items-center gap-1">
                    {row.is_overdue ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : null}
                    {row.is_overdue ? 'Overdue' : row.payment_state}
                  </StatusBadge>
                </div>
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  {row.customer_name} · due {row.due_date ?? 'on receipt'} · {row.aging_bucket.replace('_', ' ')}
                  {showLocation ? ` · ${row.location_code}` : ''}
                </p>
                <p className="metric-value mt-2 text-right text-sm font-semibold">{formatAud(Number(row.balance))} outstanding</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.ok ? (
        <nav aria-label="Receivables pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{result.hasMore ? 'More receivables available' : 'End of list'}</span>
          <div className="flex gap-2">
            {hasCursor ? (
              <Link
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
                href={href(params, { cursor_due: undefined, cursor_id: undefined })}
              >
                Back to first page
              </Link>
            ) : null}
            {result.hasMore && result.nextCursor ? (
              <Link
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
                href={href(params, { cursor_due: result.nextCursor.dueDate ?? undefined, cursor_id: result.nextCursor.invoiceId })}
              >
                Next page
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
