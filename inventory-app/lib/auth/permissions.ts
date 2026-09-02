import type { PermissionKey, UserAccessContext, UserRole } from './types';

/**
 * A role plus permission collection. Accepts a `Set` (server access context) or
 * a plain array (serialised for Client Components) so the same check works on
 * both sides of the RSC boundary.
 */
export type PermissionCarrier = {
  role: UserRole;
  permissions: ReadonlySet<PermissionKey> | readonly PermissionKey[];
};

export function hasPermission(
  access: PermissionCarrier,
  key: PermissionKey,
): boolean {
  if (access.role === 'admin') {
    return true;
  }
  // `ReadonlySet` does not narrow via `instanceof Set`, so cast the array branch.
  const { permissions } = access;
  return permissions instanceof Set
    ? permissions.has(key)
    : (permissions as readonly PermissionKey[]).includes(key);
}

export type AccessSnapshot = Omit<UserAccessContext, 'permissions'> & {
  permissions: readonly PermissionKey[];
};

/** Serialisable form of the access context for passing to Client Components. */
export function toAccessSnapshot(access: UserAccessContext): AccessSnapshot {
  return { ...access, permissions: [...access.permissions] };
}
