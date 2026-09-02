export const APP_NAME = '24/7 Inventory' as const;

export const LOCATION_CODES = ['LON', 'REG'] as const;

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
