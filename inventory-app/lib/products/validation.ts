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

const requiredMoney = z.preprocess(
  (value) => value == null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  z.coerce.number({ error: 'Retail price is required.' })
    .refine(Number.isFinite, 'Retail price must be a valid amount.')
    .refine((n) => n >= 0, 'Retail price must be zero or more.')
    .refine((n) => n <= MAX_PRICE, 'That retail price looks too large.'),
);

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

const TyreAttributesSchema = z.object({
  condition: z.enum(TYRE_CONDITIONS).optional().default('new'),
  brand: optionalText,
  pattern: optionalText,
  size: optionalText,
  loadIndex: optionalText,
  speedRating: optionalText,
});

export const ProductInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required.').max(200),
    category: z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? null : value, z.enum(PRODUCT_CATEGORY_CODES).nullable()).optional().default(null),
    partReference: optionalText,
    retailPriceInclGst: requiredMoney,
    wholesalePriceInclGst: nullableMoney,
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
