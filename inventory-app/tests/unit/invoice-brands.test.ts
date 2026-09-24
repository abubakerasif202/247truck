import { describe, expect, it } from 'vitest';

import { defaultInvoiceBrandForLocation, isInvoiceBrand } from '@/lib/finance/invoice-brands';

describe('invoice brand defaults', () => {
  it('maps the Adelaide Wholesale Tyres workspace to its brand and the 24/7 location to 247', () => {
    expect(defaultInvoiceBrandForLocation('LON')).toBe('awt');
    expect(defaultInvoiceBrandForLocation('REG')).toBe('247');
  });

  it('accepts only persisted issuer keys', () => {
    expect(isInvoiceBrand('247')).toBe(true);
    expect(isInvoiceBrand('awt')).toBe(true);
    expect(isInvoiceBrand('other')).toBe(false);
  });
});
