import { describe, expect, it } from 'vitest';

import { bottomBarItems, moreNavItems } from '../../components/shell/nav';
import type { AccessSnapshot } from '../../lib/auth/permissions';

const manager: AccessSnapshot = {
  userId: 'manager', role: 'manager', locationId: 'lon', locationCode: 'LON',
  permissions: ['quotes.view', 'jobs.view', 'pos.use'],
};

describe('sales navigation', () => {
  it('keeps the existing mobile bar and places Quotes, Jobs and POS under More', () => {
    expect(bottomBarItems(manager).map((item) => item.href)).toEqual(['/dashboard', '/inventory']);
    expect(moreNavItems(manager).map((item) => item.href)).toEqual(expect.arrayContaining(['/quotes', '/jobs', '/pos']));
  });

  it('hides each sales route without its own permission', () => {
    const none = { ...manager, permissions: [] as const };
    expect([...bottomBarItems(none), ...moreNavItems(none)].map((item) => item.href)).not.toEqual(expect.arrayContaining(['/quotes', '/jobs', '/pos']));
  });
});
