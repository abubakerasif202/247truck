import { describe, expect, it } from 'vitest';

import { parseSupplierInput } from '../../lib/purchasing/validation';

function fd(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
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
