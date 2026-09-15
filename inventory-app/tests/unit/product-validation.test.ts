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

  it('accepts a non-tyre consumable with no tyre block', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Tyre mounting paste 5kg',
      category: 'workshop_consumable',
      retailPriceInclGst: 42.5,
    });
    expect(result.success).toBe(true);
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

  it('requires retail price while keeping wholesale genuinely optional', () => {
    for (const retailPriceInclGst of ['', null, undefined, '   ']) {
      const result = ProductInputSchema.safeParse({
        name: 'Price pending valve cap',
        category: 'valve',
        retailPriceInclGst,
        wholesalePriceInclGst: '',
      });
      expect(result.success).toBe(false);
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

  it('accepts a truck tyre with no tyre attributes', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Nameless retread',
      category: 'truck_tyre',
      retailPriceInclGst: 300,
    });
    expect(result.success).toBe(true);
  });

  it('accepts only product name and retail price with optional fields normalised', () => {
    const result = ProductInputSchema.safeParse({ name: 'Test Product', retailPriceInclGst: '100.00', wholesalePriceInclGst: '', category: '', partReference: '', notes: '', tyre: { condition: 'new', brand: '', pattern: '', size: '', loadIndex: '', speedRating: '' } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ name: 'Test Product', retailPriceInclGst: 100, wholesalePriceInclGst: null, category: null, partReference: null, notes: null, tyre: { condition: 'new', brand: null, pattern: null, size: null, loadIndex: null, speedRating: null } });
  });

  it('rejects blank name and invalid retail price', () => {
    expect(ProductInputSchema.safeParse({ name: ' ', retailPriceInclGst: 100 }).success).toBe(false);
    expect(ProductInputSchema.safeParse({ name: 'Test Product', retailPriceInclGst: 'not-money' }).success).toBe(false);
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
