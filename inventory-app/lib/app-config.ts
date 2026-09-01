export const APP_NAME = '24/7 Inventory' as const;

export const LOCATION_CODES = ['LON', 'REG'] as const;

export type LocationCode = (typeof LOCATION_CODES)[number];
