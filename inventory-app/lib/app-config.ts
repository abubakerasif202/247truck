export const APP_NAME = '24/7 Inventory' as const;

export const LOCATION_CODES = ['REG', 'LON'] as const;

/** Safe operational default. Lonsdale remains available only by selection. */
export const DEFAULT_LOCATION_CODE = 'REG' as const;

export type LocationCode = (typeof LOCATION_CODES)[number];

export const LOCATION_NAMES: Record<LocationCode, string> = {
  LON: 'Lonsdale',
  REG: 'Regency Park',
};

export function isLocationCode(value: unknown): value is LocationCode {
  return (
    typeof value === 'string' &&
    (LOCATION_CODES as readonly string[]).includes(value)
  );
}
