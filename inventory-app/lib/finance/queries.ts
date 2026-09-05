import 'server-only';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { FinanceSettingsDetail } from './types';

/**
 * Loads Admin finance settings through the `finance_settings_detail` RPC, which
 * repeats the hard Admin check server-side. Phase 4A exposes only non-secret
 * identity/branch configuration; provider activation flags are read-only and
 * always false.
 */
export async function getFinanceSettingsDetail(): Promise<
  { ok: true; data: FinanceSettingsDetail } | { ok: false; error: string }
> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('finance_settings_detail');

  if (error || !data) {
    return { ok: false, error: 'Could not load finance settings. Please refresh.' };
  }

  return { ok: true, data: data as FinanceSettingsDetail };
}
