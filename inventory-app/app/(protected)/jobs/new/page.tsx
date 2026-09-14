import { randomUUID } from 'node:crypto';
import { PageHeader } from '@/components/ui/page-header';
import { SaleDraftForm } from '@/components/sales/sale-draft-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getCurrentLocationScope, getCurrentScopeLocationId } from '@/lib/location/resolve-scope';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createJobAction } from '../actions';
export default async function NewJobPage() { const access = await getCurrentAccess(); if (!hasPermission(access, 'jobs.create')) return <PageHeader title="New job" subtitle="Permission denied" />; const client = await createServerSupabaseClient(); const { data: locations } = await client.from('locations').select('id,code').eq('active', true).order('code'); const scope = await getCurrentLocationScope(access); const locationId = (await getCurrentScopeLocationId(access, scope)) ?? ''; return <div className="operations-page max-w-4xl"><PageHeader title="New workshop job" subtitle="Create a job with stock and free-text service lines" /><SaleDraftForm action={createJobAction} locationId={locationId} locations={locations ?? []} requestId={randomUUID()} actionLabel="Create job" allowWalkIn /></div>; }
