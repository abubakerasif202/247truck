import { z } from 'zod';

import {
  PRODUCT_CATEGORY_CODES,
  TYRE_CONDITIONS,
} from './types';

/** Normalises a lookup value so inconsistent typing does not fork variants. */
export function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

const MAX_PRICE = 1_000_000;

/** Rejects empty/blank input instead of silently coercing it to 0. */
const requiredNumber = (message: string) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) return Number.NaN;
    if (typeof value === 'string' && value.trim() === '') return Number.NaN;
    return value;
  }, z.coerce.number().refine((n) => Number.isFinite(n), message));

const money = requiredNumber('Enter a valid price.')
  .refine((n) => n >= 0, 'Must be zero or more.')
  .refine((n) => n <= MAX_PRICE, 'That price looks too large.');

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

const TyreAttributesSchema = z.object({
  condition: z.enum(TYRE_CONDITIONS),
  brand: z.string().trim().min(1, 'Brand is required.').max(80),
  pattern: optionalText,
  size: z.string().trim().min(1, 'Size is required.').max(80),
  loadIndex: optionalText,
  speedRating: optionalText,
});

export const ProductInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required.').max(200),
    category: z.enum(PRODUCT_CATEGORY_CODES),
    partReference: optionalText,
    sellingPriceInclGst: money,
    notes: z.string().trim().max(2000).optional().transform((v) => v ?? null),
    active: z.boolean().optional().default(true),
    tyre: TyreAttributesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.category === 'truck_tyre' && !value.tyre) {
      ctx.addIssue({
        code: 'custom',
        path: ['tyre'],
        message: 'Truck tyres need condition, brand, and size.',
      });
    }
  });

export type ProductInput = z.infer<typeof ProductInputSchema>;
