import { describe, expect, it } from 'vitest';
import { displayedRefundedAmount, refundAlgebra } from '@/lib/finance/refunds';

describe('Phase 4D refund algebra', () => {
  it('preserves unpaid debt for a partial cash-return credit', () => {
    expect(refundAlgebra({ total: 11000n, credits: 2200n, grossPaid: 5500n, reversed: 0n, authorised: 2200n, refunded: 0n }))
      .toEqual({ adjustedSale: 8800n, appliedToSale: 3300n, balance: 5500n, refundDue: 2200n, actualNetCash: 5500n });
  });

  it('supports a full-sale credit greater than cash received', () => {
    expect(refundAlgebra({ total: 100000n, credits: 100000n, grossPaid: 40000n, reversed: 0n, authorised: 40000n, refunded: 40000n }))
      .toEqual({ adjustedSale: 0n, appliedToSale: 0n, balance: 0n, refundDue: 0n, actualNetCash: 0n });
  });

  it('rejects over-authorisation instead of clamping', () => {
    expect(() => refundAlgebra({ total: 10000n, credits: 5000n, grossPaid: 4000n, reversed: 0n, authorised: 5000n, refunded: 0n }))
      .toThrow('FINANCE_INVARIANT_VIOLATION');
  });

  it('does not display a reversed payment as a refund', () => {
    expect(displayedRefundedAmount({ effectivePaid: 60, actualNetCash: 50 })).toBe(10);
  });
});
