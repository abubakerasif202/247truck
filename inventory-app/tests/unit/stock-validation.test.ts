import { describe, expect, it } from 'vitest';

import {
  StockAdjustmentSchema,
  StockInSchema,
  StockOutSchema,
  ReorderSettingsSchema,
} from '../../lib/inventory/validation';

const productId = crypto.randomUUID();
const locationId = crypto.randomUUID();

describe('StockInSchema', () => {
  it('accepts a valid stock-in', () => {
    expect(
      StockInSchema.safeParse({ productId, locationId, quantity: 12, unitCost: 445 }).success,
    ).toBe(true);
  });

  it('rejects a zero or negative quantity', () => {
    expect(
      StockInSchema.safeParse({ productId, locationId, quantity: 0, unitCost: 445 }).success,
    ).toBe(false);
    expect(
      StockInSchema.safeParse({ productId, locationId, quantity: -3, unitCost: 445 }).success,
    ).toBe(false);
  });

  it('rejects an empty unit cost instead of treating it as free', () => {
    expect(
      StockInSchema.safeParse({ productId, locationId, quantity: 5, unitCost: '' }).success,
    ).toBe(false);
  });
});

describe('ReorderSettingsSchema', () => {
  it('rejects blank thresholds instead of coercing them to zero', () => {
    expect(ReorderSettingsSchema.safeParse({
      productId,
      locationCode: 'LON',
      minimumStock: '',
      reorderQuantity: '   ',
    }).success).toBe(false);
  });
});

describe('StockOutSchema', () => {
  it('accepts a valid stock-out with an allowed reason', () => {
    expect(
      StockOutSchema.safeParse({ productId, locationId, quantity: 2, reason: 'damaged' }).success,
    ).toBe(true);
  });

  it('rejects an unlisted reason', () => {
    expect(
      StockOutSchema.safeParse({ productId, locationId, quantity: 2, reason: 'vanished' }).success,
    ).toBe(false);
  });
});

describe('StockAdjustmentSchema', () => {
  it('accepts a counted quantity with a reason', () => {
    expect(
      StockAdjustmentSchema.safeParse({
        productId,
        locationId,
        countedQuantity: 13,
        reason: 'physical_count_correction',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing reason', () => {
    expect(
      StockAdjustmentSchema.safeParse({ productId, locationId, countedQuantity: 13 }).success,
    ).toBe(false);
  });

  it('rejects a negative counted quantity', () => {
    expect(
      StockAdjustmentSchema.safeParse({
        productId,
        locationId,
        countedQuantity: -1,
        reason: 'recount',
      }).success,
    ).toBe(false);
  });
});
