import { describe, expect, it } from 'vitest';
import { MANAGER_GRANTABLE_PERMISSIONS, PERMISSION_LABELS } from '../../lib/auth/permission-keys';
import { businessDate, agingBucket, dueDate } from '../../lib/finance/dates';
import { validateDiscount } from '../../lib/finance/permissions';
import { financeError } from '../../lib/finance/errors';

describe('Phase 4A policy', () => {
  it('registers exactly the 13 grantable finance permissions and labels', () => {
    const keys = ['invoices.view','invoices.create','invoices.edit','invoices.issue','invoices.cancel','payments.view','payments.record','payments.reverse','payments.reconcile','refunds.create','receivables.view','discounts.apply','documents.send'];
    expect(MANAGER_GRANTABLE_PERMISSIONS.filter((key) => /^(invoices|payments|refunds|receivables|discounts|documents|finance)\./.test(key))).toEqual(keys);
    for (const key of keys) expect((PERMISSION_LABELS as Record<string, string>)[key]).toBeTruthy();
  });
  it('requires a separate grant, current cap, mutation permission and reason', () => {
    const base = { role: 'manager' as const, granted: true, mutationAllowed: true, cap: '10', percent: '10', reason: 'Approved service adjustment' };
    expect(validateDiscount(base)).toBe(true);
    for (const patch of [{ granted: false }, { mutationAllowed: false }, { cap: null }, { cap: '0' }, { reason: ' ' }, { percent: '10.01' }]) expect(validateDiscount({ ...base, ...patch })).toBe(false);
    expect(validateDiscount({ ...base, role: 'admin', cap: null, percent: '100' })).toBe(true);
  });
  it('uses Adelaide midnight and DST', () => {
    expect(businessDate(new Date('2026-09-05T14:29:59Z'))).toBe('2026-09-05');
    expect(businessDate(new Date('2026-09-05T14:30:00Z'))).toBe('2026-09-06');
    expect(businessDate(new Date('2026-12-01T13:30:00Z'))).toBe('2026-12-02');
  });
  it('uses calendar-day business terms and no individual term override', () => {
    expect(dueDate('2026-12-31', '7_days', 'business')).toBe('2027-01-07');
    expect(() => dueDate('2026-12-31', '7_days', 'individual')).toThrow();
  });
  it.each([[0,'Current'],[1,'1–7'],[7,'1–7'],[8,'8–14'],[14,'8–14'],[15,'15–29'],[29,'15–29'],[30,'30+']])('ages day %s without overlap', (days, expected) => {
    expect(agingBucket(Number(days))).toBe(expected);
  });
  it('does not expose unknown database errors', () => {
    expect(financeError({ message: 'secret database connection string' })).not.toContain('secret');
    expect(financeError({ message: 'FINANCE_VERSION_CONFLICT' })).toContain('reload');
  });
});
