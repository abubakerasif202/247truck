import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentAccess } from '@/lib/auth/access';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getTransferDetail } from '@/lib/transfers/queries';
import { receiveTransferFormAction } from '../../actions';

export default async function ReceiveTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess(); if (access.role !== 'admin') redirect('/transfers');
  const id = (await params).id; const transfer = await getTransferDetail(await createServerSupabaseClient(), id);
  if (transfer.status !== 'in_transit') redirect(`/transfers/${id}`);
  return <div className="grid max-w-2xl gap-6"><PageHeader title={`Receive ${transfer.transfer_number}`} subtitle={`${transfer.source_name} → ${transfer.destination_name}`} /><form action={receiveTransferFormAction.bind(null, id)} className="grid gap-5 rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Enter the physical quantity received. Short receipts are sent to Admin review; over-receipts are rejected.</p>{transfer.lines.map(line => <div key={line.id} className="grid gap-2"><Label htmlFor={`received_${line.product_id}`}>Product {line.product_id}</Label><Input id={`received_${line.product_id}`} name={`received_${line.product_id}`} type="number" min="0" max={line.dispatched_quantity} defaultValue={line.dispatched_quantity} required /></div>)}<Button type="submit">Confirm receipt</Button></form></div>;
}
