export const APP_NAME = '24/7 Inventory' as const;

export const LOCATION_CODES = ['REG', 'LON'] as const;

/** Safe operational default. Legacy `LON` code is retained for historical FK/data compatibility. */
export const DEFAULT_LOCATION_CODE = 'REG' as const;

export type LocationCode = (typeof LOCATION_CODES)[number];

export const LOCATION_NAMES: Record<LocationCode, string> = {
  LON: 'Adelaide Wholesale Tyres',
  REG: '24/7 Truck Tyre Services',
};

export function isLocationCode(value: unknown): value is LocationCode {
  return (
    typeof value === 'string' &&
    (LOCATION_CODES as readonly string[]).includes(value)
  );
}
