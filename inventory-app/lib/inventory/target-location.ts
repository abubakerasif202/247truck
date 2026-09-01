import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { LocationCode } from '@/lib/app-config';
import { isLocationCode } from '@/lib/app-config';
import type { UserAccessContext } from '@/lib/auth/types';

export type TargetLocation = { id: string; code: LocationCode };

/**
 * Resolves the location a stock action targets. Managers are pinned to their
 * assigned branch and any requested value is ignored; Admins choose LON or REG.
 * The DB RPCs re-check this, so this is the UI-facing convenience layer.
 */
export async function resolveTargetLocation(
  client: SupabaseClient,
  access: UserAccessContext,
  requestedCode: string | null | undefined,
): Promise<TargetLocation> {
  if (access.role === 'manager') {
    if (!access.locationId || !access.locationCode) {
      throw new Error('Your account has no assigned location.');
    }
    return { id: access.locationId, code: access.locationCode };
  }

  if (!isLocationCode(requestedCode)) {
    throw new Error('Choose a location.');
  }

  const { data, error } = await client
    .from('locations')
    .select('id')
    .eq('code', requestedCode)
    .eq('active', true)
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    throw new Error('That location could not be found.');
  }
  return { id: data.id, code: requestedCode };
}
