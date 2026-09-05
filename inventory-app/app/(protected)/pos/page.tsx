import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createJobAction } from '../jobs/actions';
export default async function PosPage() { const access = await getCurrentAccess(); if (!hasPermission(access, 'pos.use')) return <PageHeader title="Workshop POS" subtitle="Permission denied" />; const client = await createServerSupabaseClient(); const { data: locations } = await client.from('locations').select('id,code').eq('active', true).order('code'); const locationId = access.locationId ?? locations?.find(row => row.code === 'LON')?.id ?? locations?.[0]?.id ?? ''; return <div className="operations-page max-w-5xl"><PageHeader title="Workshop POS" subtitle="Fast job entry for the counter" /><SaleDraftForm action={createJobAction} locationId={locationId} actionLabel="Start workshop job" allowWalkIn /></div>; }
