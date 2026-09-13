'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentAccess } from '@/lib/auth/access';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function recoverPaidOrderAction(formData: FormData): Promise<void> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') throw new Error('ACCESS_DENIED');
  const orderReference = String(formData.get('orderReference') ?? '').trim();
  if (!orderReference || orderReference.length > 120) throw new Error('INVALID_ORDER_REFERENCE');
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('admin_recover_adelaide_paid_order', { p_order_reference: orderReference });
  if (error) throw new Error('Could not queue this paid order for recovery.');
  revalidatePath('/settings/reconciliation');
}
