import { describe, expect, it } from 'vitest';

import { CustomerReturnSchema } from '../../lib/inventory/validation';

const productId = crypto.randomUUID();
const locationId = crypto.randomUUID();
const creditNoteId = crypto.randomUUID();

describe('CustomerReturnSchema', () => {
  it('accepts a valid customer return with credit note reference', () => {
    const result = CustomerReturnSchema.safeParse({
      productId,
      locationId,
      quantity: 2,
      reason: 'Customer ordered wrong size - 295/80R22.5',
      unitCost: 350.50,
      creditNoteId,
      notes: 'Tyre tread inspected, zero wear, returned to active warehouse stock.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(2);
      expect(result.data.unitCost).toBe(350.50);
      expect(result.data.creditNoteId).toBe(creditNoteId);
    }
  });

  it('accepts a customer return with null unitCost to preserve existing WAC', () => {
    const result = CustomerReturnSchema.safeParse({
      productId,
      locationId,
      quantity: 1,
      reason: 'Returned under credit note',
      unitCost: null,
      creditNoteId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.unitCost).toBeNull();
    }
  });

  it('rejects a zero or negative quantity on customer return', () => {
    expect(
      CustomerReturnSchema.safeParse({
        productId,
        locationId,
        quantity: 0,
      }).success,
    ).toBe(false);

    expect(
      CustomerReturnSchema.safeParse({
        productId,
        locationId,
        quantity: -2,
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid creditNoteId format', () => {
    expect(
      CustomerReturnSchema.safeParse({
        productId,
        locationId,
        quantity: 1,
        creditNoteId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('rejects notes exceeding 2000 characters', () => {
    expect(
      CustomerReturnSchema.safeParse({
        productId,
        locationId,
        quantity: 1,
        notes: 'a'.repeat(2001),
      }).success,
    ).toBe(false);
  });
});
