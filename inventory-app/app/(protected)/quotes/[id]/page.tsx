import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.view')) return <PageHeader title="Quote" subtitle="Permission denied" />;
  const { id } = await params; const { data, error } = await (await createServerSupabaseClient()).rpc('quote_detail', { p_quote_id: id }); if (error || !data) notFound();
  return <div className="operations-page max-w-5xl"><PageHeader title={data.quote_number} subtitle={`${data.customer_snapshot?.display_name ?? 'Customer'} · ${String(data.status).replaceAll('_', ' ')}`} /><div className="grid gap-3 rounded-xl border bg-card p-5">{(data.lines ?? []).map((line: Record<string, unknown>) => <div key={String(line.id)} className="flex justify-between border-b py-2 text-sm last:border-0"><span>{String(line.description)} · {String(line.quantity)}</span><span>{line.unit_price_incl_gst == null ? 'PRICE PENDING' : `$${Number(line.line_total_incl_gst).toFixed(2)}`}</span></div>)}<div className="pt-3 text-right font-semibold">{data.total_incl_gst == null ? 'PRICE PENDING' : `$${Number(data.total_incl_gst).toFixed(2)} incl GST`}</div></div></div>;
}
