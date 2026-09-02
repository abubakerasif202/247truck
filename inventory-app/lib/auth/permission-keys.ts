import type { PermissionKey } from './types';

/**
 * The Phase 1 operational permissions an Admin can grant to a Manager. Branch
 * isolation is intentionally NOT in this list — it is a role-level property and
 * can never be granted away.
 *
 * Keep in sync with the `manager_permissions_permission_key_check` constraint in
 * `supabase/migrations/20260902090000_identity_access.sql`.
 */
export const MANAGER_GRANTABLE_PERMISSIONS = [
  'inventory.view',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.adjust',
  'inventory.view_cost',
  'inventory.edit_global_price',
  'reports.view_inventory_value',
] as const satisfies readonly PermissionKey[];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'inventory.view': 'View stock',
  'inventory.stock_in': 'Quick Stock-In',
  'inventory.stock_out': 'Stock-Out',
  'inventory.adjust': 'Stock adjustments',
  'inventory.view_cost': 'View cost price',
  'inventory.edit_global_price': 'Edit global selling price',
  'reports.view_inventory_value': 'View inventory value',
};

export function isManagerGrantablePermission(
  value: string,
): value is PermissionKey {
  return (MANAGER_GRANTABLE_PERMISSIONS as readonly string[]).includes(value);
}
