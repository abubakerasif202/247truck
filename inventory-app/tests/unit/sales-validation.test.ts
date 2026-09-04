import { describe, expect, it } from 'vitest';

import { salesLineSchema } from '../../lib/sales/validation';

describe('sales line validation', () => {
  it('requires whole positive quantities for inventory products', () => {
    expect(salesLineSchema.safeParse({ lineType: 'product', productId: crypto.randomUUID(), description: 'Tyre', quantity: '2', unitPriceInclGst: '690.00' }).success).toBe(true);
    expect(salesLineSchema.safeParse({ lineType: 'product', productId: crypto.randomUUID(), description: 'Tyre', quantity: '1.5', unitPriceInclGst: '690.00' }).success).toBe(false);
  });

  it('allows fractional labour quantities and explicit zero prices', () => {
    const result = salesLineSchema.safeParse({ lineType: 'labour', productId: null, description: 'Workshop labour', quantity: '1.5', unitPriceInclGst: '0.00' });
    expect(result.success).toBe(true);
  });

  it('allows a pending product price but never a pending labour price', () => {
    expect(salesLineSchema.safeParse({ lineType: 'product', productId: crypto.randomUUID(), description: 'Tyre', quantity: '1', unitPriceInclGst: null }).success).toBe(true);
    expect(salesLineSchema.safeParse({ lineType: 'labour', productId: null, description: 'Labour', quantity: '1', unitPriceInclGst: null }).success).toBe(false);
  });
});
