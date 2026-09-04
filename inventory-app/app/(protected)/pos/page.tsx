import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { listSalesCustomers, listSalesProducts } from '@/lib/sales/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createJobAction } from '../jobs/actions';
export default async function PosPage() { const access = await getCurrentAccess(); if (!hasPermission(access, 'pos.use')) return <PageHeader title="Workshop POS" subtitle="Permission denied" />; const client = await createServerSupabaseClient(); const scope = await getCurrentLocationScope(access); const [customers, products, locations] = await Promise.all([listSalesCustomers(client), listSalesProducts(client, scope), client.from('locations').select('id,code').eq('active', true).order('code')]); const locationId = access.locationId ?? locations.data?.find(row => row.code === 'LON')?.id ?? locations.data?.[0]?.id ?? ''; return <div className="operations-page max-w-5xl"><PageHeader title="Workshop POS" subtitle="Fast job entry for the counter" /><SaleDraftForm customers={customers} products={products} action={createJobAction} locationId={locationId} actionLabel="Start workshop job" /></div>; }
