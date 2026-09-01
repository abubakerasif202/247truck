import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import {
  mapAccessContext,
  type ManagerPermissionRow,
  type ProfileRow,
} from './access-context';
import type { UserAccessContext } from './types';

const PROFILE_COLUMNS =
  'user_id, display_name, role, active, location_id, locations(code)';

/**
 * Loads the current signed-in user's access context. Redirects to `/login` when
 * unauthenticated, when no profile exists yet, or when the profile is in a
 * disallowed state (disabled, mis-configured location, unknown role).
 */
/**
 * Request-memoised so the protected layout and the page it renders share one
 * profile lookup instead of hitting Supabase twice per navigation.
 */
export const getCurrentAccess = cache(async (): Promise<UserAccessContext> => {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw new Error('Failed to load your access profile.');
  }

  if (!profile) {
    redirect('/login?reason=no-profile');
  }

  let permissions: ManagerPermissionRow[] = [];
  if (profile.role === 'manager') {
    const { data, error: permissionError } = await supabase
      .from('manager_permissions')
      .select('permission_key, enabled')
      .eq('user_id', user.id)
      .returns<ManagerPermissionRow[]>();

    if (permissionError) {
      throw new Error('Failed to load your permissions.');
    }
    permissions = data ?? [];
  }

  try {
    return mapAccessContext(profile, permissions);
  } catch (error) {
    console.error(
      '[access] rejecting session:',
      error instanceof Error ? error.message : error,
    );
    redirect('/login?reason=account');
  }
});
