import { describe, expect, it } from 'vitest';

import { APP_NAME, DEFAULT_LOCATION_CODE, LOCATION_CODES, LOCATION_NAMES } from '../../lib/app-config';

describe('inventory app configuration', () => {
  it('defines the app name and supported locations', () => {
    expect(APP_NAME).toBe('24/7 Inventory');
    expect(LOCATION_CODES).toEqual(['REG', 'LON']);
    expect(DEFAULT_LOCATION_CODE).toBe('REG');
    expect(LOCATION_NAMES.LON).toBe('Adelaide Wholesale Tyres');
    expect(LOCATION_NAMES.REG).toBe('24/7 Truck Tyre Services');
  });
});
