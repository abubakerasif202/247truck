export const FINANCE_TIMEZONE = 'Australia/Adelaide';
export type PaymentTerms = 'due_on_receipt' | '7_days' | '14_days' | '30_days';

export function businessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: FINANCE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function dueDate(issueDate: string, terms: PaymentTerms, customerType: 'business' | 'individual' | 'walk_in'): string {
  const days = { due_on_receipt: 0, '7_days': 7, '14_days': 14, '30_days': 30 }[terms];
  if (days === undefined || (customerType !== 'business' && terms !== 'due_on_receipt')) throw new Error('INVALID_PAYMENT_TERMS');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new Error('INVALID_DATE');
  const date = new Date(`${issueDate}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== issueDate) throw new Error('INVALID_DATE');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function agingBucket(daysOverdue: number): 'Current' | '1–7' | '8–14' | '15–29' | '30+' {
  if (!Number.isSafeInteger(daysOverdue)) throw new Error('INVALID_DATE');
  if (daysOverdue <= 0) return 'Current';
  if (daysOverdue <= 7) return '1–7';
  if (daysOverdue <= 14) return '8–14';
  if (daysOverdue <= 29) return '15–29';
  return '30+';
}
