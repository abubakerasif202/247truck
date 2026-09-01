import { isLocationCode, type LocationCode } from '@/lib/app-config';

import { isManagerGrantablePermission } from './permission-keys';
import type { PermissionKey, UserAccessContext, UserRole } from './types';

type LocationJoin = { code: string } | { code: string }[] | null;

export type ProfileRow = {
  user_id: string;
  display_name: string;
  role: string;
  active: boolean;
  location_id: string | null;
  locations: LocationJoin;
};

export type ManagerPermissionRow = {
  permission_key: string;
  enabled: boolean;
};

function firstLocationCode(join: LocationJoin): LocationCode | null {
  const row = Array.isArray(join) ? join[0] : join;
  const code = row?.code ?? null;
  if (code === null) return null;
  if (!isLocationCode(code)) {
    throw new Error('UNKNOWN_LOCATION_CODE');
  }
  return code;
}

/**
 * Maps a raw `user_profiles` row (with joined location + permission rows) into
 * the strongly-typed access context the app authorises against.
 *
 * Throws named errors for every disallowed state so callers can redirect the
 * user to login rather than leak a raw database shape.
 */
export function mapAccessContext(
  profile: ProfileRow,
  permissions: readonly ManagerPermissionRow[],
): UserAccessContext {
  if (!profile.active) {
    throw new Error('ACCOUNT_DISABLED');
  }

  if (profile.role !== 'admin' && profile.role !== 'manager') {
    throw new Error('UNKNOWN_ROLE');
  }

  const role = profile.role as UserRole;
  const locationCode = firstLocationCode(profile.locations);

  if (role === 'manager' && (!profile.location_id || !locationCode)) {
    throw new Error('MANAGER_LOCATION_REQUIRED');
  }

  if (role === 'admin' && profile.location_id) {
    throw new Error('ADMIN_LOCATION_FORBIDDEN');
  }

  const enabled = new Set<PermissionKey>();
  if (role === 'manager') {
    for (const row of permissions) {
      if (row.enabled && isManagerGrantablePermission(row.permission_key)) {
        enabled.add(row.permission_key);
      }
    }
  }

  return {
    userId: profile.user_id,
    role,
    locationId: role === 'admin' ? null : profile.location_id,
    locationCode: role === 'admin' ? null : locationCode,
    permissions: enabled,
  };
}
