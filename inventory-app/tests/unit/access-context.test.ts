import { describe, expect, it } from 'vitest';

import { mapAccessContext } from '../../lib/auth/access-context';

const baseManagerRow = {
  user_id: 'u1',
  display_name: 'Casey Manager',
  role: 'manager' as const,
  active: true,
  location_id: 'l1',
  locations: { code: 'LON' as const },
};

describe('mapAccessContext', () => {
  it('rejects an inactive profile', () => {
    expect(() =>
      mapAccessContext({ ...baseManagerRow, active: false }, []),
    ).toThrow('ACCOUNT_DISABLED');
  });

  it('builds a Manager context with only enabled permissions', () => {
    const access = mapAccessContext(baseManagerRow, [
      { permission_key: 'inventory.view', enabled: true },
      { permission_key: 'inventory.stock_out', enabled: true },
      { permission_key: 'inventory.adjust', enabled: false },
    ]);

    expect(access.role).toBe('manager');
    expect(access.locationId).toBe('l1');
    expect(access.locationCode).toBe('LON');
    expect([...access.permissions].sort()).toEqual([
      'inventory.stock_out',
      'inventory.view',
    ]);
  });

  it('rejects a Manager whose assigned location did not resolve', () => {
    expect(() =>
      mapAccessContext({ ...baseManagerRow, locations: null }, []),
    ).toThrow('MANAGER_LOCATION_REQUIRED');
  });

  it('builds an Admin context with no location and an empty permission set', () => {
    const access = mapAccessContext(
      {
        user_id: 'a1',
        display_name: 'Alex Admin',
        role: 'admin',
        active: true,
        location_id: null,
        locations: null,
      },
      [],
    );

    expect(access.role).toBe('admin');
    expect(access.locationId).toBeNull();
    expect(access.locationCode).toBeNull();
    expect(access.permissions.size).toBe(0);
  });

  it('accepts an array-shaped location join', () => {
    const access = mapAccessContext(
      { ...baseManagerRow, locations: [{ code: 'REG' }] },
      [],
    );
    expect(access.locationCode).toBe('REG');
  });

  it('rejects an unknown location code', () => {
    expect(() =>
      mapAccessContext({ ...baseManagerRow, locations: { code: 'SYD' } }, []),
    ).toThrow('UNKNOWN_LOCATION_CODE');
  });

  it('rejects an unknown role', () => {
    expect(() =>
      mapAccessContext({ ...baseManagerRow, role: 'owner' }, []),
    ).toThrow('UNKNOWN_ROLE');
  });

  it('ignores permission rows for an Admin', () => {
    const access = mapAccessContext(
      {
        user_id: 'a1',
        display_name: 'Alex Admin',
        role: 'admin',
        active: true,
        location_id: null,
        locations: null,
      },
      [{ permission_key: 'inventory.adjust', enabled: true }],
    );
    expect(access.permissions.size).toBe(0);
  });

  it('drops permission keys that are not Manager-grantable', () => {
    const access = mapAccessContext(baseManagerRow, [
      { permission_key: 'inventory.view', enabled: true },
      { permission_key: 'system.everything', enabled: true },
    ]);
    expect([...access.permissions]).toEqual(['inventory.view']);
  });

  it('rejects an Admin row that carries a location', () => {
    expect(() =>
      mapAccessContext(
        {
          user_id: 'a1',
          display_name: 'Alex Admin',
          role: 'admin',
          active: true,
          location_id: 'l1',
          locations: { code: 'LON' },
        },
        [],
      ),
    ).toThrow('ADMIN_LOCATION_FORBIDDEN');
  });
});
