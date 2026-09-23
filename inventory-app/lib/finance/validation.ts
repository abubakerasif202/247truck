import { z } from 'zod';

const requestId = z.uuid();
const moneyString = z.string().trim().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).refine((value) => {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return false;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(2, '0')) > 0n;
}, 'Amount must be greater than zero.');
const optionalPaymentText = z.union([z.string().trim().max(500), z.null()]).optional().transform((value) => value || null);

export const ManualTenderSchema = z.strictObject({
  method: z.enum(['cash', 'eftpos', 'bank_transfer']), amount: moneyString,
  reference: optionalPaymentText, notes: optionalPaymentText,
  received_at: z.union([z.iso.datetime({ offset: true }), z.null()]).optional(),
});
export const RecordPaymentSchema = z.strictObject({
  request_id: requestId, expected_version: z.number().int().nonnegative(), tenders: z.array(ManualTenderSchema).min(1).max(10),
});
export const ReversePaymentSchema = z.strictObject({
  request_id: requestId, expected_version: z.number().int().nonnegative(), reason: z.string().trim().min(3).max(500),
});
const creditLine = z.strictObject({ invoice_line_id: z.uuid(), amount: moneyString });
const refundAllocation = z.strictObject({ payment_id: z.uuid(), amount: moneyString });
export const CreateCreditRefundSchema = z.strictObject({
  request_id: requestId,
  expected_version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  credit_lines: z.array(creditLine).min(1).max(100),
  authorised_refund_amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/).default('0'),
  payments: z.array(refundAllocation).max(20).default([]),
});
export const ConfirmManualRefundSchema = z.strictObject({
  request_id: requestId, expected_version: z.number().int().positive(),
  payout_method: z.enum(['cash', 'eftpos', 'bank_transfer']),
  payout_reference: z.string().trim().min(1).max(200),
  evidence: z.string().trim().min(1).max(1000),
  confirmed_at: z.union([z.iso.datetime({ offset: true }), z.null()]).optional(),
});
export const RetryRefundSchema = z.strictObject({ request_id: requestId, expected_version: z.number().int().positive() });
export type ManualTender = z.infer<typeof ManualTenderSchema>;
