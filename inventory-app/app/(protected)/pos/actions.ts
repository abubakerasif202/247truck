'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { validateSaleLineLocations } from '@/lib/sales/sale-line-location';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const optionalText = (form: FormData, key: string, max: number) => {
  const value = text(form, key);
  if (value.length > max) throw new Error(`${key === 'extra_description' ? 'Extra Description' : 'Notes'} must be ${max} characters or fewer.`);
  return value || null;
};

function zUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const KNOWN_POS_ERRORS = new Set([
  'ACCESS_DENIED',
  'INSUFFICIENT_STOCK',
  'USED_TYRE_NOT_AVAILABLE',
  'USED_TYRE_QUANTITY_MUST_BE_ONE',
  'USED_TYRE_PRODUCT_OR_LOCATION_MISMATCH',
  'RESERVATION_INCONSISTENT',
  'PRICE_PENDING',
  'PRICE_OVERRIDE_NOT_AUTHORIZED',
  'CUSTOMER_ARCHIVED',
  'VEHICLE_ARCHIVED',
  'VEHICLE_CUSTOMER_MISMATCH',
  'PRODUCT_INACTIVE',
  'JOB_VERSION_CONFLICT',
  'POS_FULL_SETTLEMENT_REQUIRED',
  'ZERO_TOTAL_TENDERS_NOT_ALLOWED',
  'PAYMENT_EXCEEDS_BALANCE',
  'FINANCE_IDENTITY_INCOMPLETE',
  'IDEMPOTENCY_KEY_REUSED',
  'INVALID_INVOICE_BRAND',
  'INVOICE_BRAND_NOT_CONFIGURED',
]);

function safePosError(message: string) {
  const code = message.match(/(?:^|: )([A-Z][A-Z0-9_]+)$/)?.[1] ?? '';
  return KNOWN_POS_ERRORS.has(code) ? code.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'The POS sale could not be finalised. Please review the sale and retry.';
}

export async function finalisePosSaleAction(form: FormData): Promise<void> {
  const access = await getCurrentAccess();
  let tenders: unknown;
  let lines: unknown;
  try {
    tenders = JSON.parse(text(form, 'tenders') || '[]') as unknown;
    lines = JSON.parse(text(form, 'lines') || '[]') as unknown;
  } catch {
    throw new Error('Check the POS lines and tender.');
  }
  if (!hasPermission(access, 'pos.use') || !hasPermission(access, 'jobs.view') || !hasPermission(access, 'jobs.create') || !hasPermission(access, 'jobs.edit') || !hasPermission(access, 'jobs.complete') || !hasPermission(access, 'invoices.view') || !hasPermission(access, 'invoices.create') || !hasPermission(access, 'invoices.issue')) {
    throw new Error('You do not have permission to finalise POS sales.');
  }
  if (!Array.isArray(tenders) || !Array.isArray(lines)) throw new Error('Check the POS lines and tender.');
  const requestedLocation = text(form, 'location_id');
  const locationId = access.role === 'admin' ? requestedLocation : access.locationId;
  if (!locationId) throw new Error('Select a branch before finalising the sale.');
  // Pricing tier is resolved authoritatively by create_job from the selected
  // customer. Do not pass the UI's display metadata into the legacy POS RPC
  // contract, which intentionally accepts only sale-line fields.
  const branchValidatedLines = validateSaleLineLocations(lines, locationId);
  const authoritativeLines = branchValidatedLines.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return line;
    const { pricing_tier: _pricingTier, ...saleLine } = line as Record<string, unknown>;
    const torque = saleLine.torque_nm;
    if (torque !== null && torque !== undefined && torque !== '') {
      const value = String(torque).trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) throw new Error('Torque must be a positive Nm value.');
      saleLine.torque_nm = value;
    } else {
      saleLine.torque_nm = null;
    }
    return saleLine;
  });
  if (tenders.length > 0 && (!hasPermission(access, 'payments.view') || !hasPermission(access, 'payments.record'))) {
    throw new Error('You do not have permission to record payment tenders.');
  }
  const requestId = text(form, 'request_id');
  if (!zUuid(requestId)) throw new Error('The sale request is invalid. Please refresh and retry.');
  // Business identity is never inferred from location: the client resolved
  // it from the location's own authorised businesses (see
  // /api/sales/business-options) and the server RPC re-derives and
  // authorises it independently via private.invoice_brand_guard, exactly
  // like p_location_id/p_organization_id authorization elsewhere. An empty
  // selection is passed through as null so the RPC's own fail-closed check
  // (not this action) is the source of truth for whether that is allowed.
  const businessBrand = text(form, 'business_brand');
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc('finalise_pos_sale_with_brand', {
    p_request_id: requestId,
    p_location_id: locationId,
    p_customer_id: text(form, 'customer_id') || null,
    p_customer_vehicle_id: text(form, 'customer_vehicle_id') || null,
    p_job_id: null,
    p_expected_job_version: null,
    p_job: {
      source_type: 'pos',
      walk_in_label: text(form, 'customer_id') ? null : 'Walk-in customer',
      extra_description: optionalText(form, 'extra_description', 5000),
      customer_notes: optionalText(form, 'customer_notes', 2000),
    },
    p_lines: authoritativeLines,
    p_tenders: tenders,
    p_brand: businessBrand || null,
  });
  if (error) {
    console.error('finalisePosSaleAction: finalise_pos_sale failed', error);
    throw new Error(safePosError(error.message));
  }
  if (!data?.invoice_id) {
    console.error('finalisePosSaleAction: finalise_pos_sale returned no invoice_id', data);
    throw new Error('The POS sale could not be finalised. Please review the sale and retry.');
  }
  revalidatePath('/pos');
  revalidatePath('/jobs');
  revalidatePath('/invoices');
  revalidatePath('/receivables');
  redirect(`/invoices/${String(data.invoice_id)}`);
}
