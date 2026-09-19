import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeListCursor } from '@/lib/listing/cursor';
import { listQuotes } from '@/lib/sales/queries';
import { formatAudOrPending } from '@/lib/format';

type Params = { cursor?: string };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view')) {
    return (
      <div className="operations-page">
        <PageHeader domain="quotes" title="Quotes" subtitle="Permission denied" />
      </div>
    );
  }
  const cursor = normalizeListCursor((await searchParams).cursor);
  const result = await listQuotes(await createServerSupabaseClient(), access.locationId, cursor);

  return (
    <div className="operations-page max-w-6xl domain-quotes">
      <PageHeader
        domain="quotes"
        title="Quotes"
        subtitle="Workshop estimates with GST-inclusive selling prices"
        actions={
          hasPermission(access, 'quotes.create') ? (
            <Link
              href="/quotes/new"
              className="flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-brand-crimson"
            >
              + Walk-in Quote
            </Link>
          ) : null
        }
      />

      {result.rows.length === 0 ? (
        <EmptyState
          title={cursor ? 'No more quotes' : 'No quotes yet'}
          description={
            cursor
              ? 'You have reached the end of the list.'
              : 'Quotes created for walk-in or account customers will appear here.'
          }
        />
      ) : (
        <>
          {/* Desktop: table. Mobile: cards. Same rows, same data-testid convention
              on the root of each variant so tests can target a specific quote
              regardless of breakpoint. */}
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Quote</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Total (incl GST)</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={String(row.id)} data-testid={`quote-row-desktop-${String(row.id)}`} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/quotes/${row.id}`} className="font-medium underline-offset-2 hover:underline">
                        {String(row.quote_number)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{String(row.customer_name)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={String(row.status)}>{String(row.status).replaceAll('_', ' ')}</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.pricing_complete ? (
                        <span className="metric-value">{formatAudOrPending(Number(row.total_incl_gst ?? 0))}</span>
                      ) : (
                        <StatusBadge tone="warning">Price pending</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2.5 md:hidden">
            {result.rows.map((row) => (
              <li key={String(row.id)} data-testid={`quote-row-mobile-${String(row.id)}`}>
                <Link
                  href={`/quotes/${row.id}`}
                  className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{String(row.quote_number)}</span>
                    <StatusBadge status={String(row.status)}>{String(row.status).replaceAll('_', ' ')}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{String(row.customer_name)}</p>
                  <p className="metric-value mt-1 text-sm font-semibold">
                    {row.pricing_complete ? `${formatAudOrPending(Number(row.total_incl_gst ?? 0))} incl GST` : 'Price pending'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {cursor || result.hasMore ? (
        <nav aria-label="Quote pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {cursor ? (
            <Link href="/quotes" className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10">
              Back to first page
            </Link>
          ) : (
            <span />
          )}
          {result.hasMore && result.nextCursor ? (
            <Link
              href={`/quotes?cursor=${encodeURIComponent(result.nextCursor)}`}
              className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
