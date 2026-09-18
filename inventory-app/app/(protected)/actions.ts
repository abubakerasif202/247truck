'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { getCurrentAccess } from '@/lib/auth/access';
import { LOCATION_SCOPE_COOKIE } from '@/lib/location/cookie';
import { parseLocationScopeRequest } from '@/lib/location/scope';

/**
 * Stores the Admin's chosen location scope. Managers can never call this
 * successfully — their scope is always derived from their profile — and the
 * cookie is never trusted for authorisation, only for the Admin's view
 * preference.
 */
export async function setLocationScopeAction(requested: string): Promise<void> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    throw new Error('Only Admins can change the location scope.');
  }

  const scope = parseLocationScopeRequest(requested);
  if (!scope) {
    throw new Error('Invalid location scope.');
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCATION_SCOPE_COOKIE, scope, {
    httpOnly: true,
    sameSite: 'lax',
    // Fail secure: only the local dev server is exempt. `NODE_ENV ===
    // 'production'` fails open if a self-hosted deployment ever forgets to
    // set it -- this cookie is view-preference only (never trusted for
    // authorisation), but there is no reason to ever send it over plain HTTP
    // outside `next dev`.
    secure: process.env.NODE_ENV !== 'development',
    path: '/',
    // Keep an explicit branch choice within the current browser session only.
    // A later session must return to Regency Park safely.
  });

  revalidatePath('/', 'layout');
}
