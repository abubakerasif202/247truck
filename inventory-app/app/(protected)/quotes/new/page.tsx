import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createQuoteAction } from '../actions';

export default async function NewQuotePage() {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.create')) return <PageHeader title="New quote" subtitle="Permission denied" />;
  const client = await createServerSupabaseClient(); const { data: locations } = await client.from('locations').select('id,code').eq('active', true).order('code');
  const locationId = access.locationId ?? locations?.find(row => row.code === 'LON')?.id ?? locations?.[0]?.id ?? '';
  return <div className="operations-page max-w-4xl"><PageHeader title="New quote" subtitle="Customer, vehicle, tyres and free-text labour" /><SaleDraftForm action={createQuoteAction} locationId={locationId} actionLabel="Save quote draft" /></div>;
}
