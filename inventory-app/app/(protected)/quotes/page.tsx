import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { listQuotes } from '@/lib/sales/queries';

export default async function QuotesPage() {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'quotes.view')) return <div className="operations-page"><PageHeader title="Quotes" subtitle="Permission denied" /></div>;
  const rows = await listQuotes(await createServerSupabaseClient(), access.locationId);
  return <div className="operations-page max-w-6xl"><PageHeader title="Quotes" subtitle="Workshop estimates with GST-inclusive selling prices" actions={hasPermission(access, 'quotes.create') ? <Link className="flex h-10 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground" href="/quotes/new">New quote</Link> : null} />{rows.length === 0 ? <div className="rounded-xl border p-8 text-sm text-muted-foreground">No quotes yet.</div> : <div className="grid gap-3">{rows.map((row: Record<string, unknown>) => <Link key={String(row.id)} href={`/quotes/${row.id}`} className="rounded-xl border bg-card p-4 hover:border-primary"><div className="flex flex-wrap items-center justify-between gap-3"><span className="font-semibold">{String(row.quote_number)}</span><StatusBadge status={String(row.status)}>{String(row.status).replaceAll('_', ' ')}</StatusBadge></div><p className="mt-2 text-sm">{String(row.customer_name)} · {row.pricing_complete ? `$${Number(row.total_incl_gst ?? 0).toFixed(2)} incl GST` : 'PRICE PENDING'}</p></Link>)}</div>}</div>;
}
