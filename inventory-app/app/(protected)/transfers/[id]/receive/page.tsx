import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TransferReceiveForm } from '@/components/transfers/transfer-lifecycle-controls';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getTransferDetail } from '@/lib/transfers/queries';

export default async function ReceiveTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'inventory.transfer_request')) redirect('/transfers');
  const id = (await params).id; const transfer = await getTransferDetail(await createServerSupabaseClient(), id);
  if (access.role === 'manager' && access.locationId !== transfer.destination_location_id) redirect(`/transfers/${id}`);
  if (transfer.status !== 'in_transit') redirect(`/transfers/${id}`);
  return <div className="grid max-w-2xl gap-6"><PageHeader title={`Receive ${transfer.transfer_number}`} subtitle={`${transfer.source_name} → ${transfer.destination_name}`} /><TransferReceiveForm id={id}><p className="text-sm text-muted-foreground">Enter the physical quantity received. Short receipts are sent to Admin review; over-receipts are rejected.</p>{transfer.lines.map(line => <div key={line.id} className="grid gap-2"><Label htmlFor={`received_${line.product_id}`}>{line.product_name}</Label><Input id={`received_${line.product_id}`} name={`received_${line.product_id}`} type="number" min="0" max={line.dispatched_quantity} defaultValue={line.dispatched_quantity} required /></div>)}</TransferReceiveForm></div>;
}
