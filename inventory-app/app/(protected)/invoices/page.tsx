import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listInvoices, type InvoiceListRow } from '@/lib/finance/queries';

export const metadata = { title: 'Invoices' };
type Params = { status?: string; source?: string; q?: string; sort?: string; direction?: string; page?: string };
function displayStatus(row: InvoiceListRow) { const status = row.display_status ?? (row.status === 'cancelled' ? 'void' : row.status === 'draft' ? 'draft' : 'sent'); return status === 'partial' ? 'partially paid' : status; }
function href(params: Params, change: Partial<Params>) { const result = new URLSearchParams(); for (const [key,value] of Object.entries({ ...params, ...change })) if (value) result.set(key, value); const query = result.toString(); return `/invoices${query ? `?${query}` : ''}`; }

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'invoices.view')) return <div className="operations-page"><PageHeader title="Invoices" subtitle="Permission denied" /></div>;
  const params = await searchParams; const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1);
  const result = await listInvoices({ status: params.status, sourceType: params.source, search: params.q, sort: params.sort, direction: params.direction, page });
  const pages = Math.max(Math.ceil(result.total / result.limit), 1);
  return <div className="operations-page max-w-6xl">
    <PageHeader title="Invoices" subtitle="Search, manage and track every customer invoice" actions={hasPermission(access, 'invoices.create') ? <Link className="flex h-10 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground" href="/invoices/new">New invoice</Link> : null} />
    <form className="mb-5 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5" role="search">
      <label className="grid gap-1 text-sm lg:col-span-2">Search<input name="q" defaultValue={params.q} placeholder="Number, customer, registration or reference" className="h-11 rounded-md border bg-background px-3" /></label>
      <label className="grid gap-1 text-sm">Status<select name="status" defaultValue={params.status ?? ''} className="h-11 rounded-md border bg-background px-3"><option value="">All statuses</option>{['draft','sent','partial','paid','overdue','void'].map((v) => <option key={v} value={v}>{v === 'partial' ? 'Partially paid' : v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Source<select name="source" defaultValue={params.source ?? ''} className="h-11 rounded-md border bg-background px-3"><option value="">All sources</option><option value="manual">Manual</option><option value="job">Workshop job</option><option value="pos">POS</option></select></label>
      <div className="flex items-end gap-2"><button className="h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground">Apply</button><Link href="/invoices" className="flex h-11 items-center px-2 text-sm underline">Clear</Link></div>
      <label className="grid gap-1 text-sm">Sort<select name="sort" defaultValue={params.sort ?? 'created_at'} className="h-11 rounded-md border bg-background px-3"><option value="created_at">Created</option><option value="issue_date">Issue date</option><option value="due_date">Due date</option><option value="invoice_number">Invoice number</option><option value="customer_name">Customer</option><option value="total">Total</option></select></label>
      <label className="grid gap-1 text-sm">Direction<select name="direction" defaultValue={params.direction ?? 'desc'} className="h-11 rounded-md border bg-background px-3"><option value="desc">Newest / highest</option><option value="asc">Oldest / lowest</option></select></label>
    </form>
    {result.rows.length === 0 ? <div className="rounded-xl border p-8 text-sm text-muted-foreground">No invoices match these filters.</div> : <div className="grid gap-3">{result.rows.map((row) => { const status = displayStatus(row); return <Link key={row.id} href={`/invoices/${row.id}`} className="rounded-xl border bg-card p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2"><div className="flex flex-wrap items-center justify-between gap-3"><span className="font-semibold">{row.invoice_number}</span><StatusBadge status={status}>{status}</StatusBadge></div><p className="mt-2 break-words text-sm text-muted-foreground">{row.customer_name ?? 'Walk-In Customer'} · {row.source_type}{row.due_date ? ` · due ${row.due_date}` : ''} · {row.pricing_complete ? `$${Number(row.total_incl_gst ?? 0).toFixed(2)}` : 'PRICE PENDING'}{row.balance != null ? ` · $${Number(row.balance).toFixed(2)} due` : ''}</p></Link>; })}</div>}
    <nav aria-label="Invoice pages" className="mt-5 flex items-center justify-between text-sm"><span>Page {Math.min(page,pages)} of {pages} · {result.total} invoices</span><div className="flex gap-2">{page > 1 ? <Link className="rounded-md border px-3 py-2" href={href(params,{page:String(page-1)})}>Previous</Link> : null}{page < pages ? <Link className="rounded-md border px-3 py-2" href={href(params,{page:String(page+1)})}>Next</Link> : null}</div></nav>
  </div>;
}
