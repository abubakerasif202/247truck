import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listCustomers } from '@/lib/customers/queries';
import { PAYMENT_TERM_LABELS, type CustomerFilter, type CustomerSummary } from '@/lib/customers/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const filters: CustomerFilter[] = ['all', 'individual', 'business', 'active', 'archived'];
const labels: Record<CustomerFilter, string> = { all: 'All', individual: 'Individuals', business: 'Fleet / Business', active: 'Active', archived: 'Archived' };

export default async function CustomersPage({ searchParams }: { searchParams: Params }) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'customers.view')) redirect('/dashboard'); const raw = await searchParams; const q = one(raw.q) ?? ''; const selected = filters.includes(one(raw.filter) as CustomerFilter) ? one(raw.filter) as CustomerFilter : 'all';
  let rows: CustomerSummary[] = []; let loadError = false;
  try { rows = await listCustomers(await createServerSupabaseClient(), q, selected); } catch { loadError = true; }
  const href = (filter: CustomerFilter) => `/customers?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  return <div className="operations-page domain-customers max-w-6xl"><PageHeader domain="customers" title="Customers" subtitle="Global customer and fleet master data" actions={hasPermission(access, 'customers.create') ? <Link href="/customers/new" className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">New customer</Link> : null} />
    <form role="search" className="operations-panel flex flex-wrap gap-3 p-4"><input name="q" defaultValue={q} placeholder="Search name, number, ABN, phone, email, registration or fleet number" className="h-10 min-w-52 flex-1 rounded-md border bg-card px-3 text-sm" /><input type="hidden" name="filter" value={selected} /><button className="h-10 rounded-md border px-4 text-sm font-medium">Search</button></form>
    <nav aria-label="Customer filters" className="flex flex-wrap gap-2">{filters.map(filter => <Link key={filter} href={href(filter)} aria-current={selected === filter ? 'page' : undefined} className={`rounded-full border px-3 py-2 text-sm ${selected === filter ? 'border-brand-red bg-brand-red-soft text-brand-deep-red' : ''}`}>{labels[filter]}</Link>)}</nav>
    {loadError ? <p role="alert" className="text-sm text-destructive">Could not load customers. Please refresh.</p> : <><div className="hidden overflow-x-auto rounded-xl border bg-card md:block"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/40"><tr>{['Number','Type','Name / company','Phone','Vehicles','Payment terms','Status'].map(x => <th key={x} className="px-4 py-3 font-semibold">{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b last:border-0"><td className="px-4 py-3"><Link className="font-semibold text-brand-deep-red hover:underline" href={`/customers/${row.id}`}>{row.customerNumber}</Link></td><td className="px-4 py-3">{row.customerType === 'business' ? 'Fleet / Business' : 'Individual'}</td><td className="px-4 py-3">{row.displayName}</td><td className="px-4 py-3">{row.phone ?? '—'}</td><td className="px-4 py-3">{row.vehicleCount}</td><td className="px-4 py-3">{PAYMENT_TERM_LABELS[row.paymentTerms]}</td><td className="px-4 py-3">{row.active ? 'Active' : 'Archived'}</td></tr>)}</tbody></table></div><div className="grid gap-3 md:hidden">{rows.map(row => <Link key={row.id} href={`/customers/${row.id}`} className="rounded-xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-muted-foreground">{row.customerNumber} · {row.customerType === 'business' ? 'Fleet / Business' : 'Individual'}</p><h2 className="mt-1 font-semibold">{row.displayName}</h2></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{row.active ? 'Active' : 'Archived'}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted-foreground"><span>Phone: {row.phone ?? '—'}</span><span>Vehicles: {row.vehicleCount}</span><span>{PAYMENT_TERM_LABELS[row.paymentTerms]}</span></div></Link>)}{rows.length === 0 ? <p className="text-sm text-muted-foreground">No customers found.</p> : null}</div></>}</div>;
}
