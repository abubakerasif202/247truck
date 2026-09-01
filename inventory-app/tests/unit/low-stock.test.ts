import { describe, expect, it } from 'vitest';

import { isLowStock, reorderSuggestion } from '../../lib/inventory/low-stock';

describe('isLowStock', () => {
  it('is true when available is below the minimum', () => {
    expect(isLowStock({ available: 4, minimumStock: 6 })).toBe(true);
  });

  it('is false when available equals or exceeds the minimum', () => {
    expect(isLowStock({ available: 6, minimumStock: 6 })).toBe(false);
    expect(isLowStock({ available: 10, minimumStock: 6 })).toBe(false);
  });

  it('is disabled when the minimum is zero', () => {
    expect(isLowStock({ available: 0, minimumStock: 0 })).toBe(false);
  });
});

describe('reorderSuggestion', () => {
  it('returns null when stock is healthy', () => {
    expect(
      reorderSuggestion({ available: 8, minimumStock: 6, reorderQuantity: 12 }),
    ).toBeNull();
  });

  it('suggests at least the shortfall, otherwise the configured reorder quantity', () => {
    expect(
      reorderSuggestion({ available: 1, minimumStock: 6, reorderQuantity: 12 }),
    ).toEqual({ shortfall: 5, suggestedOrderQuantity: 12 });

    expect(
      reorderSuggestion({ available: 1, minimumStock: 20, reorderQuantity: 4 }),
    ).toEqual({ shortfall: 19, suggestedOrderQuantity: 19 });
  });
});
