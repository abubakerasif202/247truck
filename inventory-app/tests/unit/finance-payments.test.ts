import { describe, expect, it } from 'vitest';

import { primaryNavItems } from '../../components/shell/nav';
import type { AccessSnapshot } from '../../lib/auth/permissions';
import { financeError } from '../../lib/finance/errors';
import { paymentTotalCents, paymentWarning, canReversePayment } from '../../lib/finance/payment-policy';
import { RecordPaymentSchema, ReversePaymentSchema } from '../../lib/finance/validation';

const manager = (permissions: string[]): AccessSnapshot => ({
  userId: 'manager', role: 'manager', locationId: 'lon', locationCode: 'LON', permissions: permissions as never,
});

describe('Phase 4C manual payment policy', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';

  it('accepts bounded split decimal-string tenders and optional references', () => {
    const parsed = RecordPaymentSchema.safeParse({ request_id: requestId, expected_version: 3, tenders: [
      { method: 'cash', amount: '10.00', reference: null, notes: null },
      { method: 'bank_transfer', amount: '22.35', reference: 'BANK-7', notes: 'Matched deposit' },
    ] });
    expect(parsed.success).toBe(true);
    expect(paymentTotalCents(parsed.success ? parsed.data.tenders : [])).toBe(3235n);
  });

  it.each(['0', '-1', '1.001', '1e2', '999999999999999.00'])('rejects invalid authoritative amount %s', (amount) => {
    expect(RecordPaymentSchema.safeParse({ request_id: requestId, expected_version: 1, tenders: [{ method: 'cash', amount }] }).success).toBe(false);
  });

  it('rejects unknown tenders and fields', () => {
    expect(RecordPaymentSchema.safeParse({ request_id: requestId, expected_version: 1, tenders: [{ method: 'card', amount: '1' }] }).success).toBe(false);
    expect(RecordPaymentSchema.safeParse({ request_id: requestId, expected_version: 1, tenders: [{ method: 'cash', amount: '1', cost: '0' }] }).success).toBe(false);
  });

  it('requires a stable request id and a meaningful reversal reason', () => {
    expect(ReversePaymentSchema.safeParse({ request_id: 'new-each-submit', expected_version: 1, reason: 'Wrong invoice' }).success).toBe(false);
    expect(ReversePaymentSchema.safeParse({ request_id: requestId, expected_version: 1, reason: '  ' }).success).toBe(false);
  });

  it('warns on bank-reference reuse without blocking and guards reversal UI', () => {
    expect(paymentWarning('bank_transfer', 'DEP-1', ['DEP-1'])).toContain('already appears');
    expect(paymentWarning('cash', 'DEP-1', ['DEP-1'])).toBeNull();
    expect(canReversePayment({ reversed: false, method: 'cash' })).toBe(true);
    expect(canReversePayment({ reversed: true, method: 'cash' })).toBe(false);
  });

  it('gates receivables navigation separately and maps payment errors safely', () => {
    expect(primaryNavItems(manager(['payments.view'])).some((item) => item.href === '/receivables')).toBe(false);
    expect(primaryNavItems(manager(['receivables.view'])).some((item) => item.href === '/receivables')).toBe(true);
    expect(financeError({ message: 'PAYMENT_EXCEEDS_BALANCE' })).toContain('outstanding balance');
    expect(financeError({ message: 'select * from secret_table' })).not.toContain('secret_table');
  });
});
