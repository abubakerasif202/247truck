import 'server-only';

import { cookies } from 'next/headers';

import type { UserAccessContext } from '@/lib/auth/types';
import { LOCATION_SCOPE_COOKIE } from '@/lib/location/cookie';

import { resolveLocationScope, type LocationScope } from './scope';

/**
 * Server-side helper: reads the Admin scope cookie (ignored for Managers) and
 * resolves it against the current access context.
 */
export async function getCurrentLocationScope(
  access: UserAccessContext,
): Promise<LocationScope> {
  if (access.role === 'manager') {
    return resolveLocationScope(access, null);
  }

  const cookieStore = await cookies();
  const requested = cookieStore.get(LOCATION_SCOPE_COOKIE)?.value ?? null;
  return resolveLocationScope(access, requested);
}
