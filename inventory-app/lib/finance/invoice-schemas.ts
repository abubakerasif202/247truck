import { z } from 'zod';

/**
 * Invoice action input boundaries for Phase 4B. The database RPCs repeat every
 * check (permission, cap, discount reason, money precision, version, state,
 * branch). These schemas only reject obviously malformed browser input early and
 * strip unknown keys so nothing authoritative (totals, GST, actor, cost, branch
 * override) is ever forwarded.
 */

const uuid = z.uuid();
const decimalWith = (scale: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => String(v).trim())
    .pipe(z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`), 'Enter a valid amount.'));
/** Quantities allow 3 decimal places, money 2 — mirrors the database contract. */
const quantityString = decimalWith(3);
const decimalString = decimalWith(2);
const optionalDecimal = z.union([decimalString, z.null(), z.literal('')]).transform((v) => (v === '' ? null : v));
const trimmed = z.string().trim();
const reason = trimmed.min(1).max(500);

export const PaymentTermsSchema = z.enum(['due_on_receipt', '7_days', '14_days', '30_days']);

/** One editable invoice/manual line. `id` present => edit an existing line. */
export const InvoiceLineInputSchema = z.strictObject({
  id: uuid.optional(),
  line_type: z.literal('labour').default('labour'),
  description: trimmed.min(1).max(500),
  quantity: quantityString,
  unit_price_incl_gst: optionalDecimal.optional(),
  discount_percent: z.union([decimalString, z.literal('')]).transform((v) => (v === '' ? '0' : v)).default('0'),
  discount_reason: z.union([reason, z.literal(''), z.null()]).optional(),
});

export const CreateManualInvoiceSchema = z.strictObject({
  location_id: uuid.optional(),
  customer_id: z.union([uuid, z.null()]).optional(),
  customer_vehicle_id: z.union([uuid, z.null()]).optional(),
  payment_terms: PaymentTermsSchema.optional(),
  customer_reference: z.union([trimmed.max(200), z.null()]).optional(),
  customer_notes: z.union([trimmed.max(2000), z.null()]).optional(),
  lines: z.array(InvoiceLineInputSchema).min(1).max(100),
});

export const UpdateInvoiceDraftSchema = z.strictObject({
  expected_version: z.coerce.number().int().min(1),
  payment_terms: PaymentTermsSchema.optional(),
  customer_reference: z.union([trimmed.max(200), z.null()]).optional(),
  customer_notes: z.union([trimmed.max(2000), z.null()]).optional(),
  lines: z
    .array(
      z.strictObject({
        id: uuid.optional(),
        line_type: z.literal('labour').default('labour'),
        description: trimmed.min(1).max(500),
        quantity: z.union([quantityString, z.literal('')]).optional(),
        unit_price_incl_gst: optionalDecimal.optional(),
        discount_percent: z.union([decimalString, z.literal('')]).transform((v) => (v === '' ? '0' : v)).optional(),
        discount_reason: z.union([reason, z.literal(''), z.null()]).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const ReviseInvoiceSchema = z.strictObject({
  expected_version: z.coerce.number().int().min(1),
  revision_reason: reason,
  payment_terms: PaymentTermsSchema.optional(),
  customer_reference: z.union([trimmed.max(200), z.null()]).optional(),
  customer_notes: z.union([trimmed.max(2000), z.null()]).optional(),
  lines: z
    .array(
      z.strictObject({
        id: uuid,
        description: trimmed.min(1).max(500).optional(),
        discount_percent: z.union([decimalString, z.literal('')]).transform((v) => (v === '' ? '0' : v)).optional(),
        discount_reason: z.union([reason, z.literal(''), z.null()]).optional(),
      }),
    )
    .optional(),
});

export type CreateManualInvoiceInput = z.infer<typeof CreateManualInvoiceSchema>;
export type UpdateInvoiceDraftInput = z.infer<typeof UpdateInvoiceDraftSchema>;
export type ReviseInvoiceInput = z.infer<typeof ReviseInvoiceSchema>;
