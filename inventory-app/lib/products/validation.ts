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

const nullableMoney = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return value;
  },
  z.union([
    z.null(),
    z.coerce
      .number()
      .refine(Number.isFinite, 'Enter a valid price.')
      .refine((n) => n >= 0, 'Must be zero or more.')
      .refine((n) => n <= MAX_PRICE, 'That price looks too large.'),
  ]),
);

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

const TyreAttributesSchema = z.object({
  condition: z.enum(TYRE_CONDITIONS).nullable().optional().default(null),
  brand: optionalText,
  pattern: optionalText,
  size: optionalText,
  loadIndex: optionalText,
  speedRating: optionalText,
});

export const ProductInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(200),
    category: z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? null : value, z.enum(PRODUCT_CATEGORY_CODES).nullable()).optional().default(null),
    partReference: optionalText,
    retailPriceInclGst: nullableMoney.optional().default(null),
    wholesalePriceInclGst: nullableMoney.optional().default(null),
    /** Legacy form/test compatibility; new writes use retailPriceInclGst. */
    sellingPriceInclGst: nullableMoney.optional(),
    notes: z.string().trim().max(2000).optional().transform((v) => v && v.length > 0 ? v : null),
    active: z.boolean().optional().default(true),
    tyre: TyreAttributesSchema.optional(),
  })
  .transform((value) => ({
    ...value,
    retailPriceInclGst: value.retailPriceInclGst,
    wholesalePriceInclGst: value.wholesalePriceInclGst ?? null,
  }));

export type ProductInput = z.infer<typeof ProductInputSchema>;
