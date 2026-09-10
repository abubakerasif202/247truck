import { z } from 'zod';

const uuid = z.uuid();
const trimmed = z.string().trim();
const optionalText = (max: number) => z.union([trimmed.max(max), z.null()]).optional();
const decimalWith = (scale: number) => z.union([z.number(), z.string()]).transform(String).pipe(z.string().trim().regex(new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`), 'Enter a valid amount.'));
const quantity = decimalWith(3);
const money = decimalWith(2);
const optionalMoney = z.union([money, z.null(), z.literal('')]).transform((v) => v === '' ? null : v).optional();
const date = z.union([z.iso.date(), z.null(), z.literal('')]).transform((v) => v === '' ? null : v).optional();
const reason = trimmed.min(1).max(500);

export const PaymentTermsSchema = z.enum(['due_on_receipt', '7_days', '14_days', '30_days', 'custom']);
export const JobDetailsSchema = z.strictObject({
  registration: optionalText(20), vehicle_or_fleet_id: optionalText(100), odometer_km: optionalMoney,
  service_date: date, technician_reference: optionalText(200),
}).optional();
export const TyreDetailsSchema = z.strictObject({
  brand: optionalText(100), model: optionalText(100), size: optionalText(100), position: optionalText(100),
  quantity_fitted: z.union([quantity, z.null(), z.literal('')]).transform((v) => v === '' ? null : v).optional(),
  serial_dot: optionalText(500),
}).optional();

export const InvoiceLineInputSchema = z.strictObject({
  id: uuid.optional(), line_type: z.enum(['product', 'labour']).default('labour'), product_id: uuid.nullable().optional(),
  description: trimmed.min(1).max(500), quantity, unit_price: optionalMoney, unit_price_incl_gst: optionalMoney,
  pricing_basis: z.enum(['exclusive', 'inclusive']).default('exclusive'), gst_treatment: z.enum(['taxable', 'gst_free']).default('taxable'),
  discount_type: z.enum(['percent', 'fixed']).default('percent'), discount_value: money.default('0'), tyre_details: TyreDetailsSchema,
}).superRefine((line, ctx) => {
  if (line.discount_type === 'percent' && Number(line.discount_value) > 100) ctx.addIssue({ code: 'custom', path: ['discount_value'], message: 'Discount cannot exceed 100%.' });
}).transform(({ unit_price_incl_gst, ...line }) => ({ ...line, unit_price: line.unit_price ?? unit_price_incl_gst ?? null, pricing_basis: line.unit_price == null && unit_price_incl_gst != null ? 'inclusive' as const : line.pricing_basis }));
const header = {
  customer_id: uuid.nullable().optional(), customer_vehicle_id: uuid.nullable().optional(), payment_terms: PaymentTermsSchema.optional(),
  issue_date: date, due_date: date, customer_reference: optionalText(200), customer_notes: optionalText(2000), internal_notes: optionalText(5000),
  payment_method: z.enum(['bank_transfer', 'cash', 'card', 'other']).nullable().optional(), job_details: JobDetailsSchema,
};
const requestId = uuid.default(() => crypto.randomUUID());
export const CreateManualInvoiceSchema = z.strictObject({ request_id: requestId, location_id: uuid.optional(), ...header, lines: z.array(InvoiceLineInputSchema).min(1).max(100) });
export const UpdateInvoiceDraftSchema = z.strictObject({ request_id: requestId, expected_version: z.coerce.number().int().min(1), ...header, lines: z.array(InvoiceLineInputSchema).min(1).max(100) });
export const ReviseInvoiceSchema = z.strictObject({ request_id: requestId, expected_version: z.coerce.number().int().min(1), revision_reason: reason, ...header, lines: z.array(InvoiceLineInputSchema).min(1).max(100).optional() });

export type CreateManualInvoiceInput = z.infer<typeof CreateManualInvoiceSchema>;
export type UpdateInvoiceDraftInput = z.infer<typeof UpdateInvoiceDraftSchema>;
export type ReviseInvoiceInput = z.infer<typeof ReviseInvoiceSchema>;
