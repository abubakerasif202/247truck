import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { TransferRequestForm } from '@/components/transfers/transfer-request-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function NewTransferPage() {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.transfer_request')) redirect('/transfers');
  const supabase = await createServerSupabaseClient();
  const [{ data: locations }, { data: products }] = await Promise.all([
    supabase.rpc('transfer_location_options'),
    supabase.from('products').select('id,name,part_reference').eq('active', true).order('name'),
  ]);
  const availableLocations = locations ?? [];
  return <div className="grid max-w-2xl gap-6"><PageHeader title="New stock transfer" subtitle="Request a controlled transfer between the two branches." />
    <TransferRequestForm locations={availableLocations} products={products ?? []} managerLocationId={access.role === 'manager' ? access.locationId : null} />
  </div>;
}
