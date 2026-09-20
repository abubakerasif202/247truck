import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatAud } from '@/lib/format';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listInvoices, type InvoiceListRow } from '@/lib/finance/queries';
import { describeLocationScope, getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';

export const metadata = { title: 'Invoices' };
type Params = { status?: string; source?: string; q?: string; sort?: string; direction?: string; page?: string };

function displayStatus(row: InvoiceListRow) {
  const status = row.display_status ?? (row.status === 'cancelled' ? 'void' : row.status === 'draft' ? 'draft' : 'sent');
  return status === 'partial' ? 'partially paid' : status;
}

function href(params: Params, change: Partial<Params>) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...change })) if (value) result.set(key, value);
  const query = result.toString();
  return `/invoices${query ? `?${query}` : ''}`;
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.view')) {
    return (
      <div className="operations-page max-w-6xl domain-invoices">
        <PageHeader domain="invoices" title="Invoices" subtitle="Permission denied" />
      </div>
    );
  }

  const params = await searchParams;
  const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1);
  const scope = await getCurrentLocationScope(access);
  const locationId = await getCurrentScopeLocationId(access, scope);
  const scopeLabel = describeLocationScope(scope);
  const result = await listInvoices({
    status: params.status,
    sourceType: params.source,
    search: params.q,
    sort: params.sort,
    direction: params.direction,
    page,
    locationId,
  });

  if (result.ok && page > 1 && result.rows.length === 0 && result.total > 0) {
    const lastPage = Math.max(Math.ceil(result.total / result.limit), 1);
    redirect(href(params, { page: String(lastPage) }));
  }

  const subtitle = `Search, manage and track every customer invoice · ${scopeLabel}`;
  const pages = result.ok ? Math.max(Math.ceil(result.total / result.limit), 1) : 1;

  return (
    <div className="operations-page max-w-6xl domain-invoices">
      <PageHeader
        domain="invoices"
        title="Invoices"
        subtitle={subtitle}
        actions={
          hasPermission(access, 'invoices.create') ? (
            <Link
              href="/invoices/new"
              className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-brand-crimson"
            >
              New invoice
            </Link>
          ) : null
        }
      />

      <form className="operations-panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" role="search" noValidate>
        <label className="grid gap-1 text-sm lg:col-span-2">
          Search
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Number, customer, registration or reference"
            className="h-11 rounded-md border border-input bg-card px-3 text-sm"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Status
          <select name="status" defaultValue={params.status ?? ''} className="h-11 rounded-md border border-input bg-card px-3 text-sm">
            <option value="">All statuses</option>
            {['draft', 'sent', 'partial', 'paid', 'overdue', 'void'].map((v) => (
              <option key={v} value={v}>
                {v === 'partial' ? 'Partially paid' : v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Source
          <select name="source" defaultValue={params.source ?? ''} className="h-11 rounded-md border border-input bg-card px-3 text-sm">
            <option value="">All sources</option>
            <option value="manual">Manual</option>
            <option value="job">Workshop job</option>
            <option value="pos">POS</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm">
            Apply
          </button>
          <Link href="/invoices" className="flex h-11 items-center px-2 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Clear
          </Link>
        </div>
        <label className="grid gap-1 text-sm">
          Sort
          <select name="sort" defaultValue={params.sort ?? 'created_at'} className="h-11 rounded-md border border-input bg-card px-3 text-sm">
            <option value="created_at">Created</option>
            <option value="issue_date">Issue date</option>
            <option value="due_date">Due date</option>
            <option value="invoice_number">Invoice number</option>
            <option value="customer_name">Customer</option>
            <option value="total">Total</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Direction
          <select name="direction" defaultValue={params.direction ?? 'desc'} className="h-11 rounded-md border border-input bg-card px-3 text-sm">
            <option value="desc">Newest / highest</option>
            <option value="asc">Oldest / lowest</option>
          </select>
        </label>
      </form>

      {!result.ok ? (
        <EmptyState
          tone="error"
          title="Unable to load invoices"
          description={result.error}
          action={
            <Link className="text-sm text-primary underline" href={href(params, {})}>
              Retry
            </Link>
          }
        />
      ) : result.rows.length === 0 ? (
        <EmptyState
          title="No invoices match these filters"
          description="Adjust the search, status, or source filters to see more results."
        />
      ) : (
        <>
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const status = displayStatus(row);
                  const isOverduePartial = row.display_status === 'overdue' && row.payment_state === 'partial';
                  return (
                    <tr key={row.id} data-testid={`invoice-row-${row.id}`} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link href={`/invoices/${row.id}`} prefetch={false} className="font-medium underline-offset-2 hover:underline">
                          {row.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.customer_name ?? 'Walk-In Customer'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.source_type}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.due_date ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {row.pricing_complete ? formatAud(Number(row.total_incl_gst ?? 0)) : 'PRICE PENDING'}
                      </td>
                      <td className="px-3 py-2 text-right">{row.balance != null ? formatAud(Number(row.balance)) : '—'}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={status}>
                          {status}
                          {isOverduePartial ? ' · partially paid' : ''}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2.5 md:hidden">
            {result.rows.map((row) => {
              const status = displayStatus(row);
              const isOverduePartial = row.display_status === 'overdue' && row.payment_state === 'partial';
              return (
                <li key={row.id} data-testid={`invoice-row-${row.id}`} className="rounded-lg border border-border bg-card">
                  <Link href={`/invoices/${row.id}`} prefetch={false} className="block p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium underline-offset-2">{row.invoice_number}</span>
                      <StatusBadge status={status}>
                        {status}
                        {isOverduePartial ? ' · partially paid' : ''}
                      </StatusBadge>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {row.customer_name ?? 'Walk-In Customer'} · {row.source_type}
                      {row.due_date ? ` · due ${row.due_date}` : ''}
                    </p>
                    <p className="metric-value mt-1.5 text-sm font-semibold">
                      {row.pricing_complete ? formatAud(Number(row.total_incl_gst ?? 0)) : 'PRICE PENDING'}
                      {row.balance != null ? (
                        <span className="ml-1.5 font-normal text-muted-foreground">{formatAud(Number(row.balance))} due</span>
                      ) : null}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {result.ok ? (
        <nav aria-label="Invoice pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Page {Math.min(page, pages)} of {pages} · {result.total} invoices
          </span>
          <span className="flex flex-wrap gap-2">
            {page > 1 ? (
              <Link
                href={href(params, { page: String(page - 1) })}
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
              >
                Previous
              </Link>
            ) : (
              <span aria-disabled="true" className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10 text-muted-foreground opacity-50">
                Previous
              </span>
            )}
            {page < pages ? (
              <Link
                href={href(params, { page: String(page + 1) })}
                className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
              >
                Next
              </Link>
            ) : (
              <span aria-disabled="true" className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10 text-muted-foreground opacity-50">
                Next
              </span>
            )}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
