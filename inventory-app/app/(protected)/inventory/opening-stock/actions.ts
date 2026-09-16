'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { actionError, type ActionResult } from '@/lib/action-result';
import { getCurrentAccess } from '@/lib/auth/access';
import { postOpeningStock } from '@/lib/inventory/repository';
import type { InventoryMutationResult } from '@/lib/inventory/types';
import { resolveTargetLocation } from '@/lib/inventory/target-location';
import { OpeningStockSchema } from '@/lib/inventory/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type OpeningStockActionResult = ActionResult<InventoryMutationResult>;

export async function addOpeningStockAction(
  _previous: OpeningStockActionResult | undefined,
  formData: FormData,
): Promise<OpeningStockActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') return actionError('Only Admins can add opening stock.');

  const parsed = OpeningStockSchema.safeParse({
    productId: formData.get('productId'),
    locationId: formData.get('locationId'),
    quantity: formData.get('quantity'),
    unitCost: formData.get('unitCost'),
    reference: formData.get('reference') || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodFieldErrors(parsed.error);
    return actionError(
      fieldErrors.productId ? 'Choose a product.' : fieldErrors.quantity ? 'Enter a quantity greater than zero.' : 'Please correct the highlighted fields.',
      fieldErrors,
    );
  }

  try {
    const supabase = await createServerSupabaseClient();
    const target = await resolveTargetLocation(supabase, access, formData.get('locationCode') as string);
    const result = await postOpeningStock(supabase, {
      requestId: String(formData.get('requestId') ?? crypto.randomUUID()),
      productId: parsed.data.productId,
      locationId: target.id,
      quantity: parsed.data.quantity,
      inboundUnitCost: parsed.data.unitCost,
      sourceType: 'manual_opening_stock',
      sourceId: parsed.data.reference || 'manual-entry',
    });
    revalidatePath('/dashboard');
    revalidatePath('/inventory');
    revalidatePath(`/inventory/${parsed.data.productId}`);
    revalidatePath('/stock/in');
    revalidatePath('/stock/out');
    revalidatePath('/stock/adjust');
    return { ok: true, data: result };
  } catch (error) {
    console.error('[opening-stock] manual post failed', error);
    return actionError(
      error instanceof Error && error.message !== 'The stock action could not be completed.'
        ? error.message
        : 'Opening stock could not be added. Nothing was changed.',
    );
  }
}

function zodFieldErrors(error: import('zod').ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors;
}
