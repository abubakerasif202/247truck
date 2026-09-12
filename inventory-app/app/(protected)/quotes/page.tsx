import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { normalizeListCursor } from '@/lib/listing/cursor';
import { listQuotes } from '@/lib/sales/queries';

type Params = { cursor?: string };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view')) return <div className="operations-page"><PageHeader title="Quotes" subtitle="Permission denied" /></div>;
  const cursor = normalizeListCursor((await searchParams).cursor);
  const result = await listQuotes(await createServerSupabaseClient(), access.locationId, cursor);
  return (
    <div className="operations-page max-w-6xl">
      <PageHeader
        title="Quotes"
        subtitle="Workshop estimates with GST-inclusive selling prices"
        actions={hasPermission(access, 'quotes.create') ? <Link className="flex h-10 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground" href="/quotes/new">New quote</Link> : null}
      />
      {result.rows.length === 0 ? (
        <div className="rounded-xl border p-8 text-sm text-muted-foreground">
          {cursor ? 'No more quotes.' : 'No quotes yet.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {result.rows.map((row) => (
            <Link key={String(row.id)} href={`/quotes/${row.id}`} className="rounded-xl border bg-card p-4 hover:border-primary">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold">{String(row.quote_number)}</span>
                <StatusBadge status={String(row.status)}>{String(row.status).replaceAll('_', ' ')}</StatusBadge>
              </div>
              <p className="mt-2 text-sm">
                {String(row.customer_name)} · {row.pricing_complete ? `$${Number(row.total_incl_gst ?? 0).toFixed(2)} incl GST` : 'PRICE PENDING'}
              </p>
            </Link>
          ))}
        </div>
      )}
      {(cursor || result.hasMore) ? (
        <nav aria-label="Quote pages" className="mt-5 flex items-center justify-between text-sm">
          {cursor ? <Link className="rounded-md border px-3 py-2" href="/quotes">Back to first page</Link> : <span />}
          {result.hasMore && result.nextCursor ? (
            <Link className="rounded-md border px-3 py-2" href={`/quotes?cursor=${encodeURIComponent(result.nextCursor)}`}>Next</Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
