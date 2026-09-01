import { describe, expect, it } from 'vitest';

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
  });

  it('limits a Manager to explicitly assigned permissions', () => {
    const access: UserAccessContext = {
      userId: 'manager-user',
      role: 'manager',
      locationId: 'lonsdale-location',
      locationCode: 'LON',
      permissions: new Set(['inventory.stock_out']),
    };

    expect(hasPermission(access, 'inventory.stock_out')).toBe(true);
    expect(hasPermission(access, 'inventory.adjust')).toBe(false);
  });
});
