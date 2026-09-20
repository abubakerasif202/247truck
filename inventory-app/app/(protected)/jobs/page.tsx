import Link from 'next/link';
import { Search, Wrench } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeListCursor } from '@/lib/listing/cursor';
import { listJobs } from '@/lib/sales/queries';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const statuses = ['new', 'scheduled', 'in_progress', 'waiting', 'completed', 'cancelled'];

function href(status: string | undefined, query: string, cursor: string | null) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return `/jobs${qs ? `?${qs}` : ''}`;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'jobs.view')) return <div className="operations-page domain-jobs"><PageHeader domain="jobs" title="Jobs" subtitle="Permission denied" /></div>;
  const raw = await searchParams;
  const status = statuses.includes(one(raw.status) ?? '') ? one(raw.status) : undefined;
  const query = one(raw.q) ?? '';
  const cursor = normalizeListCursor(one(raw.cursor));
  let result: { rows: Record<string, unknown>[]; hasMore: boolean; nextCursor: string | null } = { rows: [], hasMore: false, nextCursor: null };
  let error = false;
  try {
    result = await listJobs(await createServerSupabaseClient(), access.locationId, status, query, cursor);
  } catch {
    error = true;
  }
  return (
    <div className="operations-page domain-jobs max-w-6xl">
      <PageHeader
        domain="jobs"
        title="Workshop jobs"
        subtitle="Search and manage branch-scoped workshop work"
        actions={hasPermission(access, 'jobs.create') ? (
          <Link
            href="/jobs/new"
            className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-brand-crimson"
          >
            New job
          </Link>
        ) : null}
      />

      <form className="operations-panel flex flex-wrap items-center gap-3 p-4" role="search">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          name="q"
          aria-label="Search jobs"
          defaultValue={query}
          placeholder="Job number, customer or registration"
          className="h-10 min-w-52 flex-1 rounded-md border border-input bg-card px-3 text-sm"
        />
        <select name="status" aria-label="Job status" defaultValue={status ?? ''} className="h-10 rounded-md border border-input bg-card px-3 text-sm">
          <option value="">All statuses</option>
          {statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
        </select>
        <button className="h-10 rounded-md border border-input px-4 text-sm font-medium">Search</button>
      </form>

      {error ? (
        <EmptyState tone="error" title="Jobs could not be loaded" description="We couldn't retrieve the latest jobs right now. Refresh the page to try again." />
      ) : result.rows.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={cursor ? 'No more jobs match this view' : 'No jobs match this view'}
          description="Try a different search term or clear the active status filter."
        />
      ) : (
        <>
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-left text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Job #</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Vehicle</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={String(row.id)} data-testid={`job-row-${row.id}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/jobs/${row.id}`} className="font-semibold text-brand-deep-red hover:underline">
                        {String(row.job_number)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{String(row.customer_name ?? 'Walk-in')}</td>
                    <td className="px-4 py-3">{String(row.vehicle_registration ?? 'No vehicle')}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={String(row.status)}>{String(row.status).replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.pricing_complete ? (
                        <span className="metric-value">${Number(row.total_incl_gst ?? 0).toFixed(2)}</span>
                      ) : (
                        <StatusBadge tone="warning">Price pending</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {result.rows.map((row) => (
              <li key={String(row.id)} data-testid={`job-row-${row.id}`}>
                <Link href={`/jobs/${row.id}`} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                  <Wrench className="mt-0.5 size-4 shrink-0 text-jobs" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{String(row.job_number)}</p>
                        <p className="truncate text-sm text-muted-foreground">{String(row.customer_name ?? 'Walk-in')}</p>
                      </div>
                      <StatusBadge status={String(row.status)}>{String(row.status).replaceAll('_', ' ')}</StatusBadge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span>{String(row.vehicle_registration ?? 'No vehicle')}</span>
                      {row.pricing_complete ? (
                        <span className="metric-value font-semibold text-foreground">${Number(row.total_incl_gst ?? 0).toFixed(2)}</span>
                      ) : (
                        <StatusBadge tone="warning">Price pending</StatusBadge>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!error && (cursor || result.hasMore) ? (
        <nav aria-label="Job pages" className="mt-5 flex items-center justify-between text-sm">
          {cursor ? (
            <Link className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10" href={href(status, query, null)}>
              Back to first page
            </Link>
          ) : <span />}
          {result.hasMore && result.nextCursor ? (
            <Link className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10" href={href(status, query, result.nextCursor)}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
