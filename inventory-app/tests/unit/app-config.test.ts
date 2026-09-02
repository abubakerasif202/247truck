import { describe, expect, it } from 'vitest';

import { APP_NAME, LOCATION_CODES } from '../../lib/app-config';

describe('inventory app configuration', () => {
  it('defines the app name and supported locations', () => {
    expect(APP_NAME).toBe('24/7 Inventory');
    expect(LOCATION_CODES).toEqual(['LON', 'REG']);
  });
});
