import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { listSalesCustomers, listSalesProducts } from '@/lib/sales/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createQuoteAction } from '../actions';

export default async function NewQuotePage() {
  const access = await getCurrentAccess(); if (!hasPermission(access, 'quotes.create')) return <PageHeader title="New quote" subtitle="Permission denied" />;
  const client = await createServerSupabaseClient(); const scope = await getCurrentLocationScope(access); const [customers, products, locations] = await Promise.all([listSalesCustomers(client), listSalesProducts(client, access, scope), client.from('locations').select('id,code').eq('active', true).order('code')]);
  const locationId = access.locationId ?? locations.data?.find(row => row.code === 'LON')?.id ?? locations.data?.[0]?.id ?? '';
  return <div className="operations-page max-w-4xl"><PageHeader title="New quote" subtitle="Customer, vehicle, tyres and free-text labour" /><SaleDraftForm customers={customers} products={products} action={createQuoteAction} locationId={locationId} actionLabel="Save quote draft" /></div>;
}
