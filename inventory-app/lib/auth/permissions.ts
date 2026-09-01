import type { PermissionKey, UserAccessContext } from './types';

export function hasPermission(
  access: UserAccessContext,
  key: PermissionKey,
): boolean {
  return access.role === 'admin' || access.permissions.has(key);
}
