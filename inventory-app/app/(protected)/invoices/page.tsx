import Link from 'next/link';

import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listInvoices } from '@/lib/finance/queries';

export const metadata = { title: 'Invoices' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string }>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.view')) {
    return <div className="operations-page"><PageHeader title="Invoices" subtitle="Permission denied" /></div>;
  }
  const { status, source } = await searchParams;
  const rows = await listInvoices({ status: status ?? null, sourceType: source ?? null });
  return (
    <div className="operations-page max-w-6xl">
      <PageHeader
        title="Invoices"
        subtitle="Branch invoices from workshop jobs, POS and manual services"
        actions={
          hasPermission(access, 'invoices.create') ? (
            <Link className="flex h-10 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground" href="/invoices/new">
              New invoice
            </Link>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {['', 'draft', 'issued', 'cancelled'].map((value) => (
          <Link
            key={value || 'all'}
            href={value ? `/invoices?status=${value}` : '/invoices'}
            className={`rounded-md border px-3 py-1 ${status === value || (!status && !value) ? 'bg-muted font-medium' : ''}`}
          >
            {value ? value[0].toUpperCase() + value.slice(1) : 'All'}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border p-8 text-sm text-muted-foreground">No invoices yet.</div>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <Link key={row.id} href={`/invoices/${row.id}`} className="rounded-xl border bg-card p-4 hover:border-primary">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold">{row.invoice_number}</span>
                <StatusBadge status={row.status}>{row.status}</StatusBadge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {row.customer_name ?? 'Walk-In Customer'} · {row.source_type}
                {row.due_date ? ` · due ${row.due_date}` : ''} ·{' '}
                {row.pricing_complete ? `$${Number(row.total_incl_gst ?? 0).toFixed(2)} incl GST` : 'PRICE PENDING'}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
