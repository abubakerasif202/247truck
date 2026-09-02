import { describe, expect, it } from 'vitest';

import { resolveLocationScope } from '../../lib/location/scope';

describe('resolveLocationScope', () => {
  it('keeps a Manager pinned to their assigned location regardless of the request', () => {
    expect(
      resolveLocationScope({ role: 'manager', locationCode: 'LON' }, 'REG'),
    ).toEqual({ kind: 'location', code: 'LON' });

    expect(
      resolveLocationScope({ role: 'manager', locationCode: 'LON' }, 'ALL'),
    ).toEqual({ kind: 'location', code: 'LON' });

    expect(
      resolveLocationScope({ role: 'manager', locationCode: 'REG' }, null),
    ).toEqual({ kind: 'location', code: 'REG' });
  });

  it('throws when a Manager somehow has no assigned location', () => {
    expect(() =>
      resolveLocationScope({ role: 'manager', locationCode: null }, 'LON'),
    ).toThrow('MANAGER_LOCATION_REQUIRED');
  });

  it('lets an Admin choose All Locations or a single branch', () => {
    expect(
      resolveLocationScope({ role: 'admin', locationCode: null }, 'ALL'),
    ).toEqual({ kind: 'all' });

    expect(
      resolveLocationScope({ role: 'admin', locationCode: null }, 'REG'),
    ).toEqual({ kind: 'location', code: 'REG' });

    expect(
      resolveLocationScope({ role: 'admin', locationCode: null }, 'LON'),
    ).toEqual({ kind: 'location', code: 'LON' });
  });

  it('defaults an Admin with no or invalid request to All Locations', () => {
    expect(
      resolveLocationScope({ role: 'admin', locationCode: null }, null),
    ).toEqual({ kind: 'all' });

    expect(
      resolveLocationScope({ role: 'admin', locationCode: null }, 'NOPE'),
    ).toEqual({ kind: 'all' });
  });
});
