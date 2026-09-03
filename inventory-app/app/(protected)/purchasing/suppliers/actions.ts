'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentAccess } from '@/lib/auth/access';
import { mapPurchasingRpcError } from '@/lib/purchasing/errors';
import { parseSupplierInput } from '@/lib/purchasing/validation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type SupplierActionResult = {
  ok: boolean;
  error?: string;
};

function adminOnly(access: Awaited<ReturnType<typeof getCurrentAccess>>): SupplierActionResult | null {
  return access.role === 'admin'
    ? null
    : { ok: false, error: 'Only Admins can manage suppliers.' };
}

function rpcArgs(input: ReturnType<typeof parseSupplierInput>) {
  return {
    p_name: input.name,
    p_abn: input.abn,
    p_contact_name: input.contactName,
    p_phone: input.phone,
    p_email: input.email,
    p_address: input.address,
    p_payment_terms: input.paymentTerms,
    p_account_reference: input.accountReference,
    p_notes: input.notes,
  };
}

export async function createSupplierAction(
  _prev: SupplierActionResult | undefined,
  formData: FormData,
): Promise<SupplierActionResult> {
  const access = await getCurrentAccess();
  const denied = adminOnly(access);
  if (denied) return denied;

  let input: ReturnType<typeof parseSupplierInput>;
  try {
    input = parseSupplierInput(formData);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Check the supplier details.',
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('create_supplier', rpcArgs(input));
  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not create the supplier.'),
    };
  }

  revalidatePath('/purchasing/suppliers');
  return { ok: true };
}

export async function updateSupplierAction(
  supplierId: string,
  _prev: SupplierActionResult | undefined,
  formData: FormData,
): Promise<SupplierActionResult> {
  const access = await getCurrentAccess();
  const denied = adminOnly(access);
  if (denied) return denied;

  let input: ReturnType<typeof parseSupplierInput>;
  try {
    input = parseSupplierInput(formData);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Check the supplier details.',
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('update_supplier', {
    p_supplier_id: supplierId,
    ...rpcArgs(input),
  });
  if (error) {
    return {
      ok: false,
      error: mapPurchasingRpcError(error, 'Could not update the supplier.'),
    };
  }

  revalidatePath('/purchasing/suppliers');
  return { ok: true };
}

export async function setSupplierActiveAction(
  supplierId: string,
  active: boolean,
  _formData: FormData,
): Promise<void> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') return;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('set_supplier_active', {
    p_supplier_id: supplierId,
    p_active: active,
  });
  if (error) {
    console.error(
      '[purchasing] set_supplier_active failed',
      mapPurchasingRpcError(error, 'Could not update the supplier.'),
    );
    return;
  }

  revalidatePath('/purchasing/suppliers');
}
