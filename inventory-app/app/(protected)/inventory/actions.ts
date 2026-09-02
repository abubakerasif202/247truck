'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getCurrentAccess } from '@/lib/auth/access';
import { createProduct, setProductActive } from '@/lib/products/repository';
import { ProductInputSchema } from '@/lib/products/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type ProductActionResult = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
};

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
