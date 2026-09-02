import { isLocationCode, type LocationCode } from '@/lib/app-config';

export type LocationScope =
  | { kind: 'all' }
  | { kind: 'location'; code: LocationCode };

export type LocationScopeRequest = 'ALL' | LocationCode;

type ScopeActor = {
  role: 'admin' | 'manager';
  locationCode: LocationCode | null;
};

/**
 * Resolves the effective location scope for a request.
 *
 * Managers are always pinned to their assigned branch — a requested scope is
 * ignored entirely, so branch isolation cannot be widened from the client.
 * Admins may request `ALL` or a specific branch; anything else falls back to
 * `ALL`.
 */
export function resolveLocationScope(
  actor: ScopeActor,
  requested: string | null | undefined,
): LocationScope {
  if (actor.role === 'manager') {
    if (!actor.locationCode) {
      throw new Error('MANAGER_LOCATION_REQUIRED');
    }
    return { kind: 'location', code: actor.locationCode };
  }

  if (isLocationCode(requested)) {
    return { kind: 'location', code: requested };
  }

  return { kind: 'all' };
}

export function parseLocationScopeRequest(
  value: string | null | undefined,
): LocationScopeRequest | null {
  if (value === 'ALL') return 'ALL';
  if (isLocationCode(value)) return value;
  return null;
}
