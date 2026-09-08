import Link from 'next/link';

import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listReceivables } from '@/lib/finance/queries';

export const metadata = { title: 'Receivables' };

export default async function ReceivablesPage({
  searchParams,
}: { searchParams: Promise<{ state?: string; search?: string }> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'receivables.view')) {
    return <div className="operations-page"><PageHeader title="Receivables" subtitle="Permission denied" /></div>;
  }
  const { state, search } = await searchParams;
  const result = await listReceivables({ state: state ?? null, search: search ?? null });
  return (
    <div className="operations-page max-w-6xl">
      <PageHeader title="Receivables" subtitle="Issued invoice balances by due date" />
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input className="h-10 rounded-md border bg-background px-3 text-sm" name="search" defaultValue={search ?? ''} placeholder="Search invoice or customer" />
        <select className="h-10 rounded-md border bg-background px-3 text-sm" name="state" defaultValue={state ?? ''}>
          <option value="">All outstanding</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="overdue">Overdue</option>
        </select>
        <button className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground" type="submit">Filter</button>
      </form>
      {!result.ok ? <div className="rounded-xl border border-destructive/40 p-8 text-sm text-destructive" role="alert">{result.error}</div> : result.data.length === 0 ? <div className="rounded-xl border p-8 text-sm text-muted-foreground">No matching receivables.</div> : (
        <div className="grid gap-3">{result.data.map((row) => (
          <article key={row.invoice_id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {row.invoice_link_allowed ? <Link className="font-semibold text-primary underline" href={`/invoices/${row.invoice_id}`}>{row.invoice_number}</Link> : <span className="font-semibold">{row.invoice_number}</span>}
              <span className={row.is_overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>{row.is_overdue ? 'Overdue' : row.payment_state}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{row.customer_name} · due {row.due_date ?? 'on receipt'} · {row.aging_bucket.replace('_', ' ')}</p>
            <p className="mt-2 text-right font-semibold">${Number(row.balance).toFixed(2)} outstanding</p>
          </article>
        ))}</div>
      )}
    </div>
  );
}
