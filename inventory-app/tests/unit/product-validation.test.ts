import { describe, expect, it } from 'vitest';

import {
  ProductInputSchema,
  UsedTyreUnitDraftSchema,
  normalizeLookup,
} from '../../lib/products/validation';

describe('ProductInputSchema', () => {
  it('accepts a well-formed new truck tyre', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Michelin X Multi 295/80R22.5',
      category: 'truck_tyre',
      sellingPriceInclGst: 685,
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
      sellingPriceInclGst: 42.5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative selling price', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Bad tyre',
      category: 'truck_tyre',
      sellingPriceInclGst: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty selling price instead of coercing it to zero', () => {
    for (const sellingPriceInclGst of ['', null, undefined, '   ']) {
      const result = ProductInputSchema.safeParse({
        name: 'Free valve cap',
        category: 'valve',
        sellingPriceInclGst,
      });
      expect(result.success).toBe(false);
    }
  });

  it('accepts a numeric string price', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Valve cap',
      category: 'valve',
      sellingPriceInclGst: '3.50',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sellingPriceInclGst).toBe(3.5);
    }
  });

  it('rejects a truck tyre with no tyre attributes', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Nameless retread',
      category: 'truck_tyre',
      sellingPriceInclGst: 300,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = ProductInputSchema.safeParse({
      name: 'Mystery item',
      category: 'spaceship',
      sellingPriceInclGst: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe('UsedTyreUnitDraftSchema', () => {
  it('rejects negative tread depth', () => {
    const result = UsedTyreUnitDraftSchema.safeParse({
      treadDepthMm: -2,
      condition: 'good',
      costBasis: 100,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid used-unit draft', () => {
    const result = UsedTyreUnitDraftSchema.safeParse({
      treadDepthMm: 8.5,
      condition: 'good',
      costBasis: 120,
      sellingPriceOverride: 260,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid condition', () => {
    const result = UsedTyreUnitDraftSchema.safeParse({
      treadDepthMm: 5,
      condition: 'meh',
      costBasis: 10,
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
