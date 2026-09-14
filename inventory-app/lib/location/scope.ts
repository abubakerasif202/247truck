import { DEFAULT_LOCATION_CODE, isLocationCode, type LocationCode } from '@/lib/app-config';

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
 * Regency Park. `ALL` remains an explicit reporting choice, never an implicit
 * operational default.
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

  if (requested === 'ALL') {
    return { kind: 'all' };
  }

  return { kind: 'location', code: DEFAULT_LOCATION_CODE };
}

export function parseLocationScopeRequest(
  value: string | null | undefined,
): LocationScopeRequest | null {
  if (value === 'ALL') return 'ALL';
  if (isLocationCode(value)) return value;
  return null;
}
