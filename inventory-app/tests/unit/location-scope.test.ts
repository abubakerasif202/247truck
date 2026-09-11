import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionKey } from '@/lib/auth/types';

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ from })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

import { resolveLocationScope } from '../../lib/location/scope';
import { getCurrentScopeLocationId } from '../../lib/location/resolve-scope';

beforeEach(() => {
  vi.clearAllMocks();
});

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

describe('getCurrentScopeLocationId', () => {
  const manager = {
    userId: 'manager-1',
    role: 'manager' as const,
    locationId: 'location-lon-uuid',
    locationCode: 'LON' as const,
    permissions: new Set<PermissionKey>(),
  };
  const admin = {
    userId: 'admin-1',
    role: 'admin' as const,
    locationId: null,
    locationCode: null,
    permissions: new Set<PermissionKey>(),
  };

  it('gives a Manager their own location id regardless of the requested scope', async () => {
    const result = await getCurrentScopeLocationId(manager, { kind: 'location', code: 'REG' });
    expect(result).toBe('location-lon-uuid');
    expect(from).not.toHaveBeenCalled();
  });

  it('gives a Manager their own location id even for an all-locations scope', async () => {
    const result = await getCurrentScopeLocationId(manager, { kind: 'all' });
    expect(result).toBe('location-lon-uuid');
  });

  it('resolves null for an Admin with an all-locations scope', async () => {
    const result = await getCurrentScopeLocationId(admin, { kind: 'all' });
    expect(result).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('looks up the location uuid by code for an Admin with a specific branch', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'location-reg-uuid' } });
    const result = await getCurrentScopeLocationId(admin, { kind: 'location', code: 'REG' });
    expect(result).toBe('location-reg-uuid');
    expect(from).toHaveBeenCalledWith('locations');
    expect(eq).toHaveBeenCalledWith('code', 'REG');
  });
});
