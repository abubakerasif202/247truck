import { describe, expect, it } from 'vitest';

import { mapReorderSuggestion } from '../../lib/purchasing/queries';

describe('reorder query mapping', () => {
  it('maps database suggestion fields without cost-bearing data', () => {
    expect(mapReorderSuggestion({
      product_id: 'product-1',
      product_name: 'Tyre A',
      location_code: 'LON',
      available: '2',
      minimum_stock: '5',
      reorder_quantity: '8',
      preferred_supplier_id: 'supplier-1',
      preferred_supplier_name: 'Supplier A',
    })).toEqual({
      productId: 'product-1', productName: 'Tyre A', locationCode: 'LON',
      available: 2, minimumStock: 5, reorderQuantity: 8,
      preferredSupplierId: 'supplier-1', preferredSupplierName: 'Supplier A',
    });
  });

  it('rejects an unknown location from the database boundary', () => {
    expect(() => mapReorderSuggestion({
      product_id: 'product-1', product_name: 'Tyre A', location_code: 'OTHER',
      available: 0, minimum_stock: 1, reorder_quantity: 1,
      preferred_supplier_id: null, preferred_supplier_name: null,
    })).toThrow('Invalid reorder suggestion location.');
  });
});
