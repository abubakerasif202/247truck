import { randomUUID } from 'node:crypto';
import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createQuoteAction } from '../actions';

export default async function NewQuotePage() {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.create')) return <PageHeader title="New quote" subtitle="Permission denied" />;
  const client = await createServerSupabaseClient(); const { data: locations } = await client.from('locations').select('id,code').eq('active', true).order('code');
  const scope = await getCurrentLocationScope(access);
  const locationId = (await getCurrentScopeLocationId(access, scope)) ?? '';
  return <div className="operations-page max-w-4xl"><PageHeader title="New quote" subtitle="Customer, vehicle, tyres and free-text labour" /><SaleDraftForm action={createQuoteAction} locationId={locationId} locations={locations ?? []} requestId={randomUUID()} actionLabel="Save quote draft" /></div>;
}
