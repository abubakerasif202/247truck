import { describe, expect, it } from 'vitest';

import { MANAGER_GRANTABLE_PERMISSIONS } from '../../lib/auth/permission-keys';
import { hasPermission } from '../../lib/auth/permissions';
import type { UserAccessContext } from '../../lib/auth/types';

describe('hasPermission', () => {
  it('allows an Admin to adjust inventory', () => {
    const access: UserAccessContext = {
      userId: 'admin-user',
      role: 'admin',
      locationId: null,
      locationCode: null,
      permissions: new Set(),
    };

    expect(hasPermission(access, 'inventory.adjust')).toBe(true);
    expect(hasPermission(access, 'purchasing.view')).toBe(true);
  });

  it('limits a Manager to explicitly assigned permissions', () => {
    const access: UserAccessContext = {
      userId: 'manager-user',
      role: 'manager',
      locationId: 'lonsdale-location',
      locationCode: 'LON',
      permissions: new Set(['inventory.stock_out', 'purchasing.view']),
    };

    expect(hasPermission(access, 'inventory.stock_out')).toBe(true);
    expect(hasPermission(access, 'purchasing.view')).toBe(true);
    expect(hasPermission(access, 'purchasing.create_po')).toBe(false);
    expect(hasPermission(access, 'inventory.adjust')).toBe(false);
  });
});

describe('manager grantable permissions', () => {
  it('includes purchasing operations but keeps PO approval Admin-only', () => {
    expect(MANAGER_GRANTABLE_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'purchasing.view',
        'purchasing.create_po',
        'purchasing.submit_po',
        'purchasing.receive_po',
      ]),
    );
    expect(MANAGER_GRANTABLE_PERMISSIONS).not.toContain('purchasing.approve_po');
  });
});
