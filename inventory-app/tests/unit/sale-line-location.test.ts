import { describe, expect, it } from 'vitest';

import { validateSaleLineLocations } from '../../lib/sales/sale-line-location';

describe('validateSaleLineLocations', () => {
  it('rejects an inventory line selected for another branch', () => {
    expect(() => validateSaleLineLocations([
      { line_type: 'product', product_id: 'product-1', validated_location_id: 'loc-reg' },
    ], 'loc-lon')).toThrow('SALE_LINE_LOCATION_MISMATCH');
  });

  it('removes client provenance after validating the selected branch', () => {
    expect(validateSaleLineLocations([
      { line_type: 'product', product_id: 'product-1', validated_location_id: 'loc-reg' },
      { line_type: 'labour', description: 'Fit' },
    ], 'loc-reg')).toEqual([
      { line_type: 'product', product_id: 'product-1' },
      { line_type: 'labour', description: 'Fit' },
    ]);
  });
});
