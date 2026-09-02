import { describe, expect, it, vi } from 'vitest';

import { resolveTargetLocation } from '../../lib/inventory/target-location';
import type { UserAccessContext } from '../../lib/auth/types';

const manager: UserAccessContext = {
  userId: 'm1',
  role: 'manager',
  locationId: 'lon-uuid',
  locationCode: 'LON',
  permissions: new Set(),
};

const admin: UserAccessContext = {
  userId: 'a1',
  role: 'admin',
  locationId: null,
  locationCode: null,
  permissions: new Set(),
};

// The manager path never touches the client.
const noClient = {} as never;

describe('resolveTargetLocation', () => {
  it('pins a Manager to their assigned branch and ignores the requested code', async () => {
    await expect(resolveTargetLocation(noClient, manager, 'REG')).resolves.toEqual({
      id: 'lon-uuid',
      code: 'LON',
    });
    await expect(resolveTargetLocation(noClient, manager, null)).resolves.toEqual({
      id: 'lon-uuid',
      code: 'LON',
    });
  });

  it('throws when a Manager has no assigned location', async () => {
    await expect(
      resolveTargetLocation(noClient, { ...manager, locationId: null, locationCode: null }, 'LON'),
    ).rejects.toThrow(/assigned location/);
  });

  it('rejects an Admin request that is not LON or REG', async () => {
    await expect(resolveTargetLocation(noClient, admin, 'SYD')).rejects.toThrow(
      /Choose a location/,
    );
    await expect(resolveTargetLocation(noClient, admin, null)).rejects.toThrow();
  });

  it('resolves an Admin branch code to its id', async () => {
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'reg-uuid' }, error: null }),
            }),
          }),
        }),
      }),
    } as never;

    await expect(resolveTargetLocation(client, admin, 'REG')).resolves.toEqual({
      id: 'reg-uuid',
      code: 'REG',
    });
  });
});
