import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { getCurrentAccess } from '@/lib/auth/access';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getTransferDetail } from '@/lib/transfers/queries';
import { approveTransferAction, dispatchTransferAction } from '../actions';

const label = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, x => x.toUpperCase());
export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess(); const id = (await params).id;
  let transfer; try { transfer = await getTransferDetail(await createServerSupabaseClient(), id); } catch { notFound(); }
  return <div className="grid gap-6"><PageHeader title={transfer.transfer_number} subtitle={`${transfer.source_name} → ${transfer.destination_name}`} />
    <div className="flex flex-wrap items-center gap-3"><StatusBadge status={transfer.status}>{label(transfer.status)}</StatusBadge>{access.role === 'admin' && transfer.status === 'requested' && <form action={approveTransferAction.bind(null, id)}><button className={buttonVariants()} type="submit">Approve</button></form>}{access.role === 'admin' && transfer.status === 'approved' && <form action={dispatchTransferAction.bind(null, id)}><button className={buttonVariants()} type="submit">Dispatch</button></form>}{access.role === 'admin' && transfer.status === 'in_transit' && <Link className={buttonVariants()} href={`/transfers/${id}/receive`}>Receive stock</Link>}</div>
    <section className="grid gap-3 rounded-xl border bg-card p-5"><h2 className="font-semibold">Transfer lines</h2><div className="grid gap-3">{transfer.lines.map(line => <div key={line.id} className="grid gap-2 rounded-lg border p-4 sm:grid-cols-4"><span className="font-mono text-xs">{line.product_id}</span><span>Requested: {line.requested_quantity}</span><span>Dispatched: {line.dispatched_quantity}</span><span>Received: {line.received_quantity}{access.role === 'admin' && line.transfer_cost_snapshot === null ? ' · Cost Pending' : ''}</span></div>)}</div></section>
    {transfer.discrepancy_notes && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">Review required: {transfer.discrepancy_notes}</p>}
  </div>;
}
