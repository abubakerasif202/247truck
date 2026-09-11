import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';

import { LOCATION_NAMES } from '@/lib/app-config';
import type { UserAccessContext } from '@/lib/auth/types';
import { LOCATION_SCOPE_COOKIE } from '@/lib/location/cookie';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { resolveLocationScope, type LocationScope } from './scope';

/**
 * Server-side helper: reads the Admin scope cookie (ignored for Managers) and
 * resolves it against the current access context.
 */
export const getCurrentLocationScope = cache(
  async (access: UserAccessContext): Promise<LocationScope> => {
    if (access.role === 'manager') {
      return resolveLocationScope(access, null);
    }

    const cookieStore = await cookies();
    const requested = cookieStore.get(LOCATION_SCOPE_COOKIE)?.value ?? null;
    return resolveLocationScope(access, requested);
  },
);

/**
 * Resolves a location scope to the location uuid an RPC's `p_location_id`
 * argument expects. Managers always resolve to their own assigned location —
 * the passed-in scope is never trusted for them, so a Manager can never
 * widen or redirect their query to another branch. Admins resolve `all` to
 * `null` (no filter) and a specific branch code to its uuid via `locations`.
 */
export const getCurrentScopeLocationId = cache(
  async (access: UserAccessContext, scope: LocationScope): Promise<string | null> => {
    if (access.role === 'manager') {
      return access.locationId;
    }

    if (scope.kind === 'all') {
      return null;
    }

    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.from('locations').select('id').eq('code', scope.code).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  },
);

/** Human-readable label for a resolved location scope, for page subtitles. */
export function describeLocationScope(scope: LocationScope): string {
  if (scope.kind === 'all') return 'All locations';
  return `${LOCATION_NAMES[scope.code]} (${scope.code})`;
}
