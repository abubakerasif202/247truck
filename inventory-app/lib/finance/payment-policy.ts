import { decimalUnits } from './money';
import type { ManualTender } from './validation';

export function paymentTotalCents(tenders: readonly Pick<ManualTender, 'amount'>[]): bigint {
  return tenders.reduce((sum, tender) => sum + decimalUnits(tender.amount, 2, 14), 0n);
}
export function paymentWarning(method: ManualTender['method'], reference: string | null, existingReferences: readonly string[]): string | null {
  if (method !== 'bank_transfer' || !reference?.trim()) return null;
  return existingReferences.includes(reference.trim()) ? 'This bank reference already appears on this invoice. Confirm the deposit before recording; reuse is allowed.' : null;
}
export function canReversePayment(payment: { reversed: boolean; method: string }): boolean {
  return !payment.reversed && ['cash', 'eftpos', 'bank_transfer'].includes(payment.method);
}
