import { describe, expect, it } from 'vitest';

import {
  ProductInputSchema,
  normalizeLookup,
} from '../../lib/products/validation';

describe('ProductInputSchema', () => {
  it('accepts a well-formed new truck tyre', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Michelin X Multi 295/80R22.5',
      category: 'truck_tyre',
      retailPriceInclGst: 685,
      wholesalePriceInclGst: 600,
      tyre: {
        condition: 'new',
        brand: 'Michelin',
        pattern: 'X Multi',
        size: '295/80R22.5',
        loadIndex: '152/148',
        speedRating: 'M',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a truck tyre with only name and retail price', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Quick entry truck tyre',
      category: 'truck_tyre',
      retailPriceInclGst: 399,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a non-tyre consumable with no tyre block', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Tyre mounting paste 5kg',
      category: 'workshop_consumable',
      retailPriceInclGst: 42.5,
    });
    expect(result.success).toBe(true);
  });

  it('requires a retail price', () => {
    for (const retailPriceInclGst of ['', null, undefined, '   ']) {
      const result = ProductInputSchema.safeParse({
        name: 'Missing price product',
        category: 'truck_tyre',
        retailPriceInclGst,
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects a negative retail price', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Bad tyre',
      category: 'truck_tyre',
      retailPriceInclGst: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative wholesale price', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Bad wholesale price',
      category: 'truck_tyre',
      retailPriceInclGst: 100,
      wholesalePriceInclGst: -1,
    });
    expect(result.success).toBe(false);
  });

  it('keeps a blank wholesale price genuinely unknown', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Wholesale pending valve cap',
      category: 'valve',
      retailPriceInclGst: 3.5,
      wholesalePriceInclGst: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.wholesalePriceInclGst).toBeNull();
    }
  });

  it('keeps an explicit zero retail price distinct from unknown', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Explicit zero test',
      category: 'valve',
      retailPriceInclGst: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.retailPriceInclGst).toBe(0);
  });

  it('accepts a numeric string price', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Valve cap',
      category: 'valve',
      retailPriceInclGst: '3.50',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retailPriceInclGst).toBe(3.5);
    }
  });

  it('rejects an unknown category', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Mystery item',
      category: 'spaceship',
      retailPriceInclGst: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('normalizeLookup', () => {
  it('collapses whitespace and upper-cases', () => {
    expect(normalizeLookup('  x  multi  ')).toBe('X MULTI');
    expect(normalizeLookup('295/80r22.5')).toBe('295/80R22.5');
  });
});
