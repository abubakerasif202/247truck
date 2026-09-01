import { z } from 'zod';

export const STOCK_OUT_REASONS = [
  'damaged',
  'write_off',
  'internal_use',
  'missing',
  'data_correction',
  'warranty_return',
  'supplier_return',
  'other',
] as const;

export type StockOutReason = (typeof STOCK_OUT_REASONS)[number];

export const STOCK_OUT_REASON_LABELS: Record<StockOutReason, string> = {
  damaged: 'Damaged',
  write_off: 'Write-off',
  internal_use: 'Internal use',
  missing: 'Missing',
  data_correction: 'Data correction',
  warranty_return: 'Warranty return',
  supplier_return: 'Supplier return',
  other: 'Other',
};

const MAX_TREAD_DEPTH_MM = 40;

/** Turns blank / missing input into NaN so `required` numbers reject it. */
function blankToNaN(value: unknown): unknown {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === 'string' && value.trim() === '') return Number.NaN;
  return value;
}

const requiredInt = (message: string) =>
  z.preprocess(blankToNaN, z.coerce.number().refine(Number.isInteger, message));

const requiredNumber = (message: string) =>
  z.preprocess(blankToNaN, z.coerce.number().refine(Number.isFinite, message));

const positiveQuantity = requiredInt('Enter a quantity.').refine(
  (n) => n > 0,
  'Quantity must be at least 1.',
);

const nonNegativeCount = requiredInt('Enter a counted quantity.').refine(
  (n) => n >= 0,
  'Counted quantity cannot be negative.',
);

const money = (message: string) =>
  requiredNumber(message).refine((n) => n >= 0, 'Amount cannot be negative.');

const idPair = {
  productId: z.uuid(),
  locationId: z.uuid(),
};

export const ReorderSettingsSchema = z.object({
  productId: z.uuid(),
  locationCode: z.enum(['LON', 'REG']),
  minimumStock: requiredInt('Enter a minimum stock threshold.').refine(
    (n) => n >= 0,
    'Minimum stock cannot be negative.',
  ),
  reorderQuantity: requiredInt('Enter a reorder quantity.').refine(
    (n) => n >= 0,
    'Reorder quantity cannot be negative.',
  ),
});

export const StockInSchema = z.object({
  ...idPair,
  quantity: positiveQuantity,
  unitCost: money('Enter a unit cost.'),
  supplier: z.string().trim().max(160).optional(),
  reference: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const StockOutSchema = z.object({
  ...idPair,
  quantity: positiveQuantity,
  reason: z.enum(STOCK_OUT_REASONS),
  notes: z.string().trim().max(2000).optional(),
});

export const StockAdjustmentSchema = z.object({
  ...idPair,
  countedQuantity: nonNegativeCount,
  reason: z.string().trim().min(3, 'A reason is required.').max(200),
  notes: z.string().trim().max(2000).optional(),
});

export const UsedTyreIntakeSchema = z.object({
  ...idPair,
  treadDepthMm: requiredNumber('Enter a tread depth.')
    .refine((n) => n >= 0, 'Tread depth cannot be negative.')
    .refine((n) => n <= MAX_TREAD_DEPTH_MM, 'Tread depth looks too large.'),
  condition: z.enum(['excellent', 'good', 'fair', 'scrap']),
  costBasis: money('Enter a cost basis.'),
  sellingPriceOverride: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().finite().nonnegative().optional(),
  ),
  notes: z.string().trim().max(2000).optional(),
});

export type StockInInput = z.infer<typeof StockInSchema>;
export type StockOutInput = z.infer<typeof StockOutSchema>;
export type StockAdjustmentInput = z.infer<typeof StockAdjustmentSchema>;
export type UsedTyreIntakeFormInput = z.infer<typeof UsedTyreIntakeSchema>;
