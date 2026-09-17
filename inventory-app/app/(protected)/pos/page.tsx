import { randomUUID } from 'node:crypto';
import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { finalisePosSaleAction } from './actions';
export default async function PosPage() { const access = await getCurrentAccess(); if (!hasPermission(access, 'pos.use')) return <PageHeader title="Workshop POS" subtitle="Permission denied" />; const client = await createServerSupabaseClient(); const { data: locations } = await client.from('locations').select('id,code').eq('active', true).order('code'); const scope = await getCurrentLocationScope(access); const locationId = (await getCurrentScopeLocationId(access, scope)) ?? ''; return <div className="operations-page max-w-5xl"><PageHeader title="Workshop POS" subtitle="Fast job entry with atomic completion, invoice and tender" /><SaleDraftForm action={finalisePosSaleAction} locationId={locationId} locations={locations ?? []} requestId={randomUUID()} actionLabel="Finalise POS sale" allowWalkIn tenderMode requireBusinessSelection /></div>; }
