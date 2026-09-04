'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { assignOpeningStockCost } from '@/lib/inventory/repository';
import {
  createProduct,
  setProductActive,
  setProductSellingPrice,
} from '@/lib/products/repository';
import { ProductInputSchema } from '@/lib/products/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type ProductActionResult = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
};

export type FinancialActionResult = {
  ok: boolean;
  error?: string;
};

const NullablePriceSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return value;
  },
  z.union([
    z.null(),
    z.coerce
      .number()
      .refine((value) => Number.isFinite(value), 'Enter a valid price.')
      .refine((value) => value >= 0, 'Price must be zero or more.')
      .refine((value) => value <= 1_000_000, 'That price looks too large.'),
  ]),
);

const RequiredCostSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return Number.NaN;
    if (typeof value === 'string' && value.trim() === '') return Number.NaN;
    return value;
  },
  z.coerce
    .number()
    .refine((value) => Number.isFinite(value), 'Enter a valid unit cost.')
    .refine((value) => value >= 0, 'Unit cost must be zero or more.')
    .refine((value) => value <= 1_000_000, 'That cost looks too large.'),
);

function readForm(formData: FormData) {
  const category = String(formData.get('category') ?? '');
  const isTyre = category === 'truck_tyre' || formData.get('isTyre') === 'on';
  const brand = String(formData.get('tyreBrand') ?? '').trim();
  const size = String(formData.get('tyreSize') ?? '').trim();

  return {
    name: formData.get('name'),
    category,
    partReference: formData.get('partReference') || undefined,
    sellingPriceInclGst: formData.get('sellingPriceInclGst'),
    notes: formData.get('notes') || undefined,
    tyre:
      isTyre && (brand || size)
        ? {
            condition: String(formData.get('tyreCondition') ?? 'new'),
            brand,
            pattern: formData.get('tyrePattern') || undefined,
            size,
            loadIndex: formData.get('tyreLoadIndex') || undefined,
            speedRating: formData.get('tyreSpeedRating') || undefined,
          }
        : undefined,
  };
}

export async function createProductAction(
  _prev: ProductActionResult | undefined,
  formData: FormData,
): Promise<ProductActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can create products.' };
  }

  const parsed = ProductInputSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const supabase = await createServerSupabaseClient();
  let created: { id: string };
  try {
    created = await createProduct(supabase, parsed.data);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not create the product.',
    };
  }

  revalidatePath('/inventory');
  redirect(`/inventory/${created.id}`);
}

export async function setProductActiveAction(
  productId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can archive products.' };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await setProductActive(supabase, productId, active);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not update the product.',
    };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${productId}`);
  return { ok: true };
}

export async function setProductSellingPriceAction(
  productId: string,
  _previous: FinancialActionResult | undefined,
  formData: FormData,
): Promise<FinancialActionResult> {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.edit_global_price')) {
    return { ok: false, error: 'You do not have permission to edit the selling price.' };
  }

  const parsed = NullablePriceSchema.safeParse(formData.get('sellingPriceInclGst'));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid selling price.' };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await setProductSellingPrice(supabase, productId, parsed.data);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not update the selling price.',
    };
  }

  revalidatePath('/inventory');
  revalidatePath(`/inventory/${productId}`);
  return { ok: true };
}

export async function assignOpeningStockCostAction(
  productId: string,
  _previous: FinancialActionResult | undefined,
  formData: FormData,
): Promise<FinancialActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can assign opening stock cost.' };
  }

  const movementId = String(formData.get('movementId') ?? '').trim();
  if (!movementId) {
    return { ok: false, error: 'Opening stock movement is required.' };
  }

  const parsed = RequiredCostSchema.safeParse(formData.get('unitCost'));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a valid unit cost.' };
  }

  const supabase = await createServerSupabaseClient();
  try {
    await assignOpeningStockCost(supabase, movementId, parsed.data);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not assign the opening stock cost.',
    };
  }

  revalidatePath('/dashboard');
  revalidatePath('/inventory');
  revalidatePath(`/inventory/${productId}`);
  return { ok: true };
}
