import { describe, expect, it } from 'vitest';
import { calculateInvoice, decimalUnits, financeBalances } from '../../lib/finance/money';

describe('Phase 4A exact finance arithmetic', () => {
  it.each(['1.001', '-1', 'NaN', 'Infinity', '1e2', ''])('rejects invalid money %s', (value) => {
    expect(() => decimalUnits(value, 2, 14)).toThrow();
  });
  it('rejects quantity precision and persisted overflow', () => {
    expect(() => decimalUnits('1.0001', 3, 12)).toThrow();
    expect(() => decimalUnits('1000000000000', 2, 14)).toThrow();
  });
  it('retains pending price, validates quantity even for pending lines, and allows zero', () => {
    expect(calculateInvoice([{ quantity: '1', price: null, discount: '0' }])).toBeNull();
    expect(() => calculateInvoice([{ quantity: '0', price: null, discount: '0' }])).toThrow();
    expect(calculateInvoice([{ quantity: '1', price: '0', discount: '0' }])?.total).toBe(0n);
  });
  it('rounds base before discount and handles 0% and 100%', () => {
    expect(calculateInvoice([{ quantity: '1', price: '110', discount: '0' }])).toMatchObject({ total: 11000n, gst: 1000n, exGst: 10000n });
    expect(calculateInvoice([{ quantity: '0.5', price: '0.01', discount: '50' }])?.total).toBe(0n);
    expect(calculateInvoice([{ quantity: '1', price: '110', discount: '100' }])?.total).toBe(0n);
    expect(() => calculateInvoice([{ quantity: '1', price: '110', discount: '100.01' }])).toThrow();
  });
  it('allocates GST remainder by line position without header drift', () => {
    const result = calculateInvoice(Array.from({ length: 6 }, () => ({ quantity: '1', price: '0.01', discount: '0' })));
    expect(result?.gst).toBe(1n);
    expect(result?.lines.map((line) => line.gst)).toEqual([1n, 0n, 0n, 0n, 0n, 0n]);
    expect(result?.lines.reduce((sum, line) => sum + line.gst, 0n)).toBe(result?.gst);
  });
  it('keeps pending refunds separate from AR and rejects invalid ledgers', () => {
    expect(financeBalances(11000n, 2200n, 5500n, 2200n, 0n)).toEqual({ adjustedSale: 8800n, appliedToSale: 3300n, balance: 5500n, refundDue: 2200n, actualNetCash: 5500n });
    expect(() => financeBalances(110n, 0n, 111n, 0n, 0n)).toThrow();
    expect(() => financeBalances(110n, 22n, 55n, 22n, 23n)).toThrow();
  });
});
