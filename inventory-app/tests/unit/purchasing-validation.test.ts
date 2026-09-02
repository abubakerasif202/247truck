import { describe, expect, it } from 'vitest';

import * as purchasingValidation from '../../lib/purchasing/validation';

const { parseSupplierInput } = purchasingValidation;

type DraftParser = (formData: FormData) => {
  locationId: string;
  supplierId: string;
  supplierReference: string | null;
  notes: string | null;
  lines: Array<{
    productId: string;
    orderedQuantity: number;
    unitCost: number;
    notes: string | null;
  }>;
};

function parseDraft(formData: FormData) {
  const parser = (
    purchasingValidation as typeof purchasingValidation & {
      parsePurchaseOrderDraft?: DraftParser;
    }
  ).parsePurchaseOrderDraft;

  if (!parser) throw new Error('parsePurchaseOrderDraft is not implemented.');
  return parser(formData);
}

function fd(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function draftFd(overrides: Record<string, string> = {}): FormData {
  return fd({
    locationId: 'location-lon',
    supplierId: 'supplier-1',
    supplierReference: '  SUP-PO-42  ',
    notes: '  Deliver to rear loading bay  ',
    lines: JSON.stringify([
      {
        productId: 'product-1',
        orderedQuantity: 4,
        unitCost: 125.5,
        notes: '  steer axle  ',
      },
    ]),
    ...overrides,
  });
}

describe('parseSupplierInput', () => {
  it('rejects a blank supplier name', () => {
    expect(() => parseSupplierInput(fd({ name: '   ' }))).toThrow(
      'Supplier name is required.',
    );
  });

  it('trims fields, lowercases email, and converts blank optionals to null', () => {
    const parsed = parseSupplierInput(
      fd({
        name: '  Bridgestone Australia  ',
        abn: '  123 456 789  ',
        contactName: '  Sales Team  ',
        phone: '  08 8123 4567  ',
        email: ' SALES@EXAMPLE.COM ',
        address: '  1 Supplier Street  ',
        paymentTerms: '  30 days  ',
        accountReference: '  ACCT-12  ',
        notes: '   ',
      }),
    );

    expect(parsed).toEqual({
      name: 'Bridgestone Australia',
      abn: '123 456 789',
      contactName: 'Sales Team',
      phone: '08 8123 4567',
      email: 'sales@example.com',
      address: '1 Supplier Street',
      paymentTerms: '30 days',
      accountReference: 'ACCT-12',
      notes: null,
    });
  });

  it('rejects names over 160 characters', () => {
    expect(() => parseSupplierInput(fd({ name: 'x'.repeat(161) }))).toThrow(
      'Supplier name is too long.',
    );
  });

  it('rejects standard optional fields over 500 characters', () => {
    expect(() =>
      parseSupplierInput(fd({ name: 'Supplier', contactName: 'x'.repeat(501) })),
    ).toThrow('Contact name is too long.');
  });

  it('allows address and notes up to 2000 characters and rejects longer values', () => {
    expect(
      parseSupplierInput(
        fd({ name: 'Supplier', address: 'a'.repeat(2000), notes: 'n'.repeat(2000) }),
      ).address,
    ).toHaveLength(2000);

    expect(() =>
      parseSupplierInput(fd({ name: 'Supplier', address: 'a'.repeat(2001) })),
    ).toThrow('Address is too long.');
    expect(() =>
      parseSupplierInput(fd({ name: 'Supplier', notes: 'n'.repeat(2001) })),
    ).toThrow('Notes are too long.');
  });
});

describe('parsePurchaseOrderDraft', () => {
  it('rejects blank location and supplier IDs', () => {
    expect(() => parseDraft(draftFd({ locationId: '   ' }))).toThrow(
      'Location is required.',
    );
    expect(() => parseDraft(draftFd({ supplierId: '   ' }))).toThrow(
      'Supplier is required.',
    );
  });

  it('rejects a draft with zero lines', () => {
    expect(() => parseDraft(draftFd({ lines: '[]' }))).toThrow(
      'Add at least one purchase order line.',
    );
  });

  it('rejects duplicate product IDs', () => {
    expect(() =>
      parseDraft(
        draftFd({
          lines: JSON.stringify([
            { productId: 'product-1', orderedQuantity: 1, unitCost: 10 },
            { productId: 'product-1', orderedQuantity: 2, unitCost: 11 },
          ]),
        }),
      ),
    ).toThrow('Duplicate products are not allowed.');
  });

  it('rejects quantity below one', () => {
    expect(() =>
      parseDraft(
        draftFd({
          lines: JSON.stringify([
            { productId: 'product-1', orderedQuantity: 0, unitCost: 10 },
          ]),
        }),
      ),
    ).toThrow('Quantity must be at least 1.');
  });

  it('rejects negative or non-finite costs', () => {
    expect(() =>
      parseDraft(
        draftFd({
          lines: JSON.stringify([
            { productId: 'product-1', orderedQuantity: 1, unitCost: -0.01 },
          ]),
        }),
      ),
    ).toThrow('Unit cost must be a finite amount of 0 or more.');

    for (const unitCost of ['NaN', 'Infinity']) {
      expect(() =>
        parseDraft(
          draftFd({
            lines: JSON.stringify([
              { productId: 'product-1', orderedQuantity: 1, unitCost },
            ]),
          }),
        ),
      ).toThrow('Unit cost must be a finite amount of 0 or more.');
    }
  });

  it('rejects costs with more than four decimal places', () => {
    expect(() =>
      parseDraft(
        draftFd({
          lines: JSON.stringify([
            { productId: 'product-1', orderedQuantity: 1, unitCost: '10.12345' },
          ]),
        }),
      ),
    ).toThrow('Unit cost supports up to 4 decimal places.');
  });

  it('normalizes a valid draft', () => {
    expect(parseDraft(draftFd())).toEqual({
      locationId: 'location-lon',
      supplierId: 'supplier-1',
      supplierReference: 'SUP-PO-42',
      notes: 'Deliver to rear loading bay',
      lines: [
        {
          productId: 'product-1',
          orderedQuantity: 4,
          unitCost: 125.5,
          notes: 'steer axle',
        },
      ],
    });
  });
});
