import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TransferLifecycleControls } from '@/components/transfers/transfer-lifecycle-controls';
import { StatusBadge } from '@/components/ui/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getTransferDetail } from '@/lib/transfers/queries';

const label = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, x => x.toUpperCase());
export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess(); const id = (await params).id;
  let transfer; try { transfer = await getTransferDetail(await createServerSupabaseClient(), id); } catch { notFound(); }
  const canOperate = hasPermission(access, 'inventory.transfer_request');
  const canDispatch = canOperate && (access.role === 'admin' || access.locationId === transfer.source_location_id);
  const canReceive = canOperate && (access.role === 'admin' || access.locationId === transfer.destination_location_id);
  return <div className="grid gap-6"><PageHeader title={transfer.transfer_number} subtitle={`${transfer.source_name} → ${transfer.destination_name}`} />
    <div className="flex flex-wrap items-center gap-3"><StatusBadge status={transfer.status}>{label(transfer.status)}</StatusBadge><TransferLifecycleControls id={id} status={transfer.status} isAdmin={access.role === 'admin'} canDispatch={canDispatch} />{canReceive && transfer.status === 'in_transit' && <Link className={buttonVariants()} href={`/transfers/${id}/receive`}>Receive stock</Link>}</div>
    <section className="grid gap-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Transfer lines</h2><div className="grid gap-3">{transfer.lines.map(line => <div key={line.id} className="grid gap-2 rounded-lg border p-4 sm:grid-cols-4"><strong>{line.product_name}</strong><span>Requested: {line.requested_quantity}</span><span>Dispatched: {line.dispatched_quantity}</span><span>Received: {line.received_quantity}{hasPermission(access, 'inventory.view_cost') && line.transfer_cost_snapshot === null ? ' · Cost Pending' : ''}</span></div>)}</div></section>
    {transfer.discrepancy_notes && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">Review required: {transfer.discrepancy_notes}</p>}
    <section className="grid gap-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Activity</h2><ol className="grid gap-3">{transfer.activity.map(event => <li key={event.id} className="flex flex-wrap justify-between gap-2 border-b pb-3 last:border-0"><span>{label(event.event_type.replace('TRANSFER_', ''))}</span><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('en-AU')}</time></li>)}</ol></section>
  </div>;
}
