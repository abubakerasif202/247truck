import { describe, expect, it } from 'vitest';

import { defaultInvoiceBrandForLocation, isInvoiceBrand } from '@/lib/finance/invoice-brands';

describe('invoice brand defaults', () => {
  it('maps the active AWT workspace to AWT and Regency Park to 24/7', () => {
    expect(defaultInvoiceBrandForLocation('LON')).toBe('awt');
    expect(defaultInvoiceBrandForLocation('REG')).toBe('247');
  });

  it('accepts only persisted issuer keys', () => {
    expect(isInvoiceBrand('247')).toBe(true);
    expect(isInvoiceBrand('awt')).toBe(true);
    expect(isInvoiceBrand('other')).toBe(false);
  });
});
