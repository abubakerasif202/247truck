import { describe, expect, it } from 'vitest';

import {
  bottomBarItems,
  isActivePath,
  moreNavItems,
  primaryNavItems,
} from '../../components/shell/nav';
import type { AccessSnapshot } from '../../lib/auth/permissions';

const admin: AccessSnapshot = {
  userId: 'admin',
  role: 'admin',
  locationId: null,
  locationCode: null,
  permissions: [],
};
const manager: AccessSnapshot = {
  userId: 'manager',
  role: 'manager',
  locationId: 'lon',
  locationCode: 'LON',
  permissions: ['purchasing.view'],
};
const restrictedManager: AccessSnapshot = { ...manager, permissions: [] };

describe('purchasing navigation', () => {
  it('shows Purchasing to Admin through existing permission semantics', () => {
    expect(primaryNavItems(admin)).toContainEqual({
      href: '/purchasing/purchase-orders',
      label: 'Purchasing',
      permission: 'purchasing.view',
      placement: 'more',
    });
  });

  it('shows Purchasing to an authorized Manager only in More', () => {
    expect(moreNavItems(manager).map((item) => item.label)).toContain('Purchasing');
    expect(bottomBarItems(manager).map((item) => item.label)).not.toContain('Purchasing');
  });

  it('hides Purchasing from an unauthorized Manager', () => {
    expect(primaryNavItems(restrictedManager).map((item) => item.label)).not.toContain('Purchasing');
  });

  it('keeps nested purchasing order routes active', () => {
    const href = '/purchasing/purchase-orders';
    expect(isActivePath(href, href)).toBe(true);
    expect(isActivePath(`${href}/new`, href)).toBe(true);
    expect(isActivePath(`${href}/po-1/receive`, href)).toBe(true);
    expect(isActivePath('/purchasing/reorder', href)).toBe(false);
  });
});
