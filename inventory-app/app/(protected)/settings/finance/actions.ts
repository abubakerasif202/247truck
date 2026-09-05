'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentAccess } from '@/lib/auth/access';
import {
  GlobalFinanceSettingsSchema,
  BranchFinanceSettingsSchema,
} from '@/lib/finance/validation';
import type { ActionResult } from '@/lib/action-result';
import { actionError } from '@/lib/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const KNOWN_ERRORS: Record<string, string> = {
  ACCESS_DENIED: 'You do not have access to finance settings.',
  FINANCE_VERSION_CONFLICT:
    'These settings changed in another tab. Reload and review your changes.',
  INVALID_FINANCE_INPUT: 'Please check the finance settings and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already used. Please reload.',
};

function safeError(message: string): string {
  const code = message.match(/([A-Z][A-Z0-9_]{3,})/)?.[1] ?? '';
  return KNOWN_ERRORS[code] ?? 'The finance settings could not be saved.';
}

/** Trims a form value to a string, or null when empty. */
function text(form: FormData, key: string): string | null {
  const value = String(form.get(key) ?? '').trim();
  return value === '' ? null : value;
}

function readAddress(form: FormData, prefix: string) {
  const address = {
    street_address: text(form, `${prefix}.street_address`),
    suburb: text(form, `${prefix}.suburb`),
    state: text(form, `${prefix}.state`),
    postcode: text(form, `${prefix}.postcode`),
    country: text(form, `${prefix}.country`),
  };
  return Object.values(address).every((value) => value === null) ? null : address;
}

const ScopeSchema = z.object({
  scope: z.enum(['global', 'branch']),
  locationId: z.union([z.uuid(), z.null()]),
  expectedVersion: z.coerce.number().int().min(0),
});

export async function updateFinanceSettingsAction(
  _prev: ActionResult<{ version: number }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ version: number }>> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return actionError('Only Admins can change finance settings.');
  }

  const scopeParsed = ScopeSchema.safeParse({
    scope: formData.get('scope'),
    locationId: formData.get('locationId') || null,
    expectedVersion: formData.get('expectedVersion'),
  });
  if (!scopeParsed.success) {
    return actionError('Please reload the finance settings page.');
  }
  const { scope, locationId, expectedVersion } = scopeParsed.data;

  let settings: Record<string, unknown>;
  if (scope === 'global') {
    const parsed = GlobalFinanceSettingsSchema.safeParse({
      business_name: text(formData, 'business_name'),
      abn: text(formData, 'abn'),
      address: readAddress(formData, 'address'),
      phone: text(formData, 'phone'),
      shared_email: text(formData, 'shared_email'),
      logo_asset_path: text(formData, 'logo_asset_path'),
      logo_sha256: text(formData, 'logo_sha256'),
      bank_instructions: (() => {
        const bank = {
          bank_name: text(formData, 'bank.bank_name'),
          account_name: text(formData, 'bank.account_name'),
          bsb: text(formData, 'bank.bsb'),
          account_number: text(formData, 'bank.account_number'),
          payment_reference: text(formData, 'bank.payment_reference'),
          instructions: text(formData, 'bank.instructions'),
        };
        return Object.values(bank).every((value) => value === null) ? null : bank;
      })(),
      invoice_footer: text(formData, 'invoice_footer'),
    });
    if (!parsed.success) {
      return actionError('Please correct the highlighted fields.', z.flattenError(parsed.error).fieldErrors);
    }
    settings = parsed.data;
  } else {
    if (!locationId) return actionError('Please reload the finance settings page.');
    const parsed = BranchFinanceSettingsSchema.safeParse({
      branch_name: text(formData, 'branch_name'),
      address: readAddress(formData, 'address'),
      phone: text(formData, 'phone'),
      contact_email: text(formData, 'contact_email'),
      document_footer: text(formData, 'document_footer'),
    });
    if (!parsed.success) {
      return actionError('Please correct the highlighted fields.', z.flattenError(parsed.error).fieldErrors);
    }
    settings = parsed.data;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('update_finance_settings', {
    p_request_id: randomUUID(),
    p_expected_version: expectedVersion,
    p_location_id: scope === 'global' ? null : locationId,
    p_settings: settings,
  });

  if (error) {
    return actionError(safeError(error.message));
  }

  revalidatePath('/settings/finance');
  return { ok: true, data: { version: (data as { version: number }).version } };
}
