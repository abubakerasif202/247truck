import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, Search, User } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { listCustomersPage } from '@/lib/customers/queries';
import { PAYMENT_TERM_LABELS, type CustomerFilter, type CustomerSummary } from '@/lib/customers/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const filters: CustomerFilter[] = ['all', 'individual', 'business', 'active', 'archived'];
const labels: Record<CustomerFilter, string> = { all: 'All', individual: 'Individuals', business: 'Fleet / Business', active: 'Active', archived: 'Archived' };
const PAGE_SIZE = 25;

function TypeLabel({ customerType }: { customerType: CustomerSummary['customerType'] }) {
  const Icon = customerType === 'business' ? Building2 : User;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {customerType === 'business' ? 'Fleet / Business' : 'Individual'}
    </span>
  );
}

export default async function CustomersPage({ searchParams }: { searchParams: Params }) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'customers.view')) redirect('/dashboard'); const raw = await searchParams; const q = one(raw.q) ?? ''; const selected = filters.includes(one(raw.filter) as CustomerFilter) ? one(raw.filter) as CustomerFilter : 'all';
  const page = Math.max(Number.parseInt(one(raw.page) ?? '1', 10) || 1, 1);
  let rows: CustomerSummary[] = []; let total = 0; let loadError = false;
  try {
    const result = await listCustomersPage(await createServerSupabaseClient(), q, selected, (page - 1) * PAGE_SIZE, PAGE_SIZE);
    rows = result.rows; total = result.total;
  } catch { loadError = true; }
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const href = (filter: CustomerFilter, targetPage = 1) => `/customers?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}${targetPage > 1 ? `&page=${targetPage}` : ''}`;
  if (!loadError && page > 1 && rows.length === 0 && total > 0) redirect(href(selected, totalPages));

  return (
    <div className="operations-page domain-customers max-w-6xl">
      <PageHeader
        domain="customers"
        title="Customers"
        subtitle="Global customer and fleet master data"
        actions={
          hasPermission(access, 'customers.create') ? (
            <Link
              href="/customers/new"
              prefetch={false}
              className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-brand-crimson"
            >
              New customer
            </Link>
          ) : null
        }
      />

      <form role="search" className="operations-panel flex flex-wrap items-center gap-3 p-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          name="q"
          aria-label="Search customers"
          defaultValue={q}
          placeholder="Search name, number, ABN, phone, email, registration or fleet number"
          className="h-10 min-w-52 flex-1 rounded-md border border-input bg-card px-3 text-sm"
        />
        <input type="hidden" name="filter" value={selected} />
        <button className="h-10 rounded-md border border-input px-4 text-sm font-medium">Search</button>
      </form>

      <nav aria-label="Customer filters" className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Link
            key={filter}
            href={href(filter)}
            aria-current={selected === filter ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-2 text-sm font-medium transition-colors',
              selected === filter
                ? 'border-brand-red bg-brand-red-soft text-brand-deep-red'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {labels[filter]}
          </Link>
        ))}
      </nav>

      {loadError ? (
        <div role="alert">
          <EmptyState
            tone="error"
            title="Could not load customers"
            description="We couldn't retrieve customer data right now. Refresh the page to try again."
          />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No customers found"
          description="Try a different search term or clear the active filter."
        />
      ) : (
        <>
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-left text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {['Number', 'Type', 'Name / company', 'Phone', 'Vehicles', 'Payment terms', 'Status'].map((x) => (
                    <th key={x} className="px-4 py-3 font-medium">{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`customer-row-${row.id}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link prefetch={false} className="font-semibold text-brand-deep-red hover:underline" href={`/customers/${row.id}`}>
                        {row.customerNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><TypeLabel customerType={row.customerType} /></td>
                    <td className="px-4 py-3">{row.displayName}</td>
                    <td className="px-4 py-3">{row.phone ?? '—'}</td>
                    <td className="px-4 py-3">{row.vehicleCount}</td>
                    <td className="px-4 py-3">{PAYMENT_TERM_LABELS[row.paymentTerms]}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.active ? 'active' : 'archived'}>{row.active ? 'Active' : 'Archived'}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {rows.map((row) => {
              const Icon = row.customerType === 'business' ? Building2 : User;
              return (
                <li key={row.id} data-testid={`customer-row-${row.id}`}>
                  <Link prefetch={false} href={`/customers/${row.id}`} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground">
                            {row.customerNumber} · {row.customerType === 'business' ? 'Fleet / Business' : 'Individual'}
                          </p>
                          <h2 className="mt-1 truncate font-semibold">{row.displayName}</h2>
                        </div>
                        <StatusBadge status={row.active ? 'active' : 'archived'}>{row.active ? 'Active' : 'Archived'}</StatusBadge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                        <span>Phone: {row.phone ?? '—'}</span>
                        <span>Vehicles: {row.vehicleCount}</span>
                        <span>{PAYMENT_TERM_LABELS[row.paymentTerms]}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <nav aria-label="Customer pages" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Page {Math.min(page, totalPages)} of {totalPages} · {total} customers</span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10" href={href(selected, page - 1)}>
                  Previous
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10" href={href(selected, page + 1)}>
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
