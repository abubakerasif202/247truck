import { describe, expect, it } from 'vitest';

import {
  calculateDocumentTotals,
  calculateLineTotalCents,
  formatCentsAud,
} from '../../lib/sales/money';

describe('sales money', () => {
  it('calculates GST-inclusive line totals in integer cents', () => {
    expect(calculateLineTotalCents('2', '690.00')).toBe(138_000);
    expect(calculateLineTotalCents('1.5', '110.00')).toBe(16_500);
    expect(calculateLineTotalCents('0.333', '10.00')).toBe(333);
  });

  it('keeps a pending price distinct from an explicit zero price', () => {
    expect(calculateLineTotalCents('1', null)).toBeNull();
    expect(calculateLineTotalCents('1', '0.00')).toBe(0);
    expect(formatCentsAud(null)).toBe('PRICE PENDING');
    expect(formatCentsAud(0)).toBe('$0.00');
  });

  it('extracts one-eleventh GST and preserves the total exactly', () => {
    const totals = calculateDocumentTotals([11_000, 5_500, 0]);
    expect(totals).toEqual({ subtotalExGstCents: 15_000, gstCents: 1_500, totalInclGstCents: 16_500 });
    if (!totals) throw new Error('Expected complete totals');
    expect(totals.subtotalExGstCents + totals.gstCents).toBe(totals.totalInclGstCents);
  });

  it('marks the document pending when any line has no price', () => {
    expect(calculateDocumentTotals([11_000, null])).toBeNull();
  });
});
