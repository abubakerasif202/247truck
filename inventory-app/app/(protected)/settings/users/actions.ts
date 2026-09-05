'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentAccess } from '@/lib/auth/access';
import { recordAuditEvent } from '@/lib/auth/audit';
import { isManagerGrantablePermission } from '@/lib/auth/permission-keys';
import type { PermissionKey } from '@/lib/auth/types';
import { LOCATION_CODES } from '@/lib/app-config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceSupabaseClient } from '@/lib/supabase/service';

export type UsersActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Manager discount cap: a percentage ceiling (0–100) on positive per-line
 * discounts. `NULL`/empty means no positive discount authority. It is a cap, not
 * a grant — `discounts.apply` must still be granted separately.
 */
const DiscountCapSchema = z
  .union([z.literal(''), z.coerce.number().min(0).max(100)])
  .transform((value) => (value === '' ? null : value))
  .nullable();

const InviteManagerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  displayName: z.string().trim().min(2).max(120),
  locationCode: z.enum(LOCATION_CODES),
  financeDiscountLimitPercent: DiscountCapSchema,
  permissions: z
    .array(z.string())
    .transform((keys) => keys.filter(isManagerGrantablePermission)),
});

function readForm(formData: FormData) {
  return {
    email: formData.get('email'),
    displayName: formData.get('displayName'),
    locationCode: formData.get('locationCode'),
    financeDiscountLimitPercent: String(formData.get('financeDiscountLimitPercent') ?? '').trim(),
    permissions: formData.getAll('permissions').map(String),
  };
}

/** Finds an existing Auth user id for an email, scanning up to 4000 accounts. */
async function findAuthUserIdByEmail(
  service: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) break;
  }
  return null;
}

type ManagerProfileInput = {
  displayName: string;
  locationId: string;
  financeDiscountLimitPercent: number | null;
  permissions: PermissionKey[];
};

/**
 * Inserts the Manager profile + permission rows for a freshly-invited user.
 * On any failure it fully unwinds (permissions, profile, Auth user) and reports
 * whether the compensation itself succeeded so the caller can warn about an
 * orphan that needs manual cleanup.
 */
async function persistManagerProfile(
  service: SupabaseClient,
  userId: string,
  input: ManagerProfileInput,
): Promise<{ ok: true } | { ok: false; error: string; orphanUserId?: string }> {
  const { error: profileError } = await service.from('user_profiles').insert({
    user_id: userId,
    display_name: input.displayName,
    role: 'manager',
    location_id: input.locationId,
    finance_discount_limit_percent: input.financeDiscountLimitPercent,
  });

  if (profileError) {
    const { error: deleteError } = await service.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('[invite] failed to clean up Auth user', userId, deleteError.message);
      return {
        ok: false,
        error: 'Could not create the Manager profile, and cleanup failed.',
        orphanUserId: userId,
      };
    }
    return { ok: false, error: 'Could not create the Manager profile. The invitation was cancelled.' };
  }

  if (input.permissions.length > 0) {
    const { error: permissionError } = await service
      .from('manager_permissions')
      .insert(
        input.permissions.map((permission_key) => ({
          user_id: userId,
          permission_key,
          enabled: true,
        })),
      );

    if (permissionError) {
      await service.from('user_profiles').delete().eq('user_id', userId);
      const { error: deleteError } = await service.auth.admin.deleteUser(userId);
      if (deleteError) {
        console.error('[invite] failed to clean up Auth user', userId, deleteError.message);
        return {
          ok: false,
          error: 'Could not assign permissions, and cleanup failed.',
          orphanUserId: userId,
        };
      }
      return { ok: false, error: 'Could not assign permissions. The invitation was cancelled.' };
    }
  }

  return { ok: true };
}

export async function inviteManagerAction(
  _prev: UsersActionResult | undefined,
  formData: FormData,
): Promise<UsersActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can invite Managers.' };
  }

  const parsed = InviteManagerSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const { email, displayName, locationCode, financeDiscountLimitPercent, permissions } =
    parsed.data;

  const userClient = await createServerSupabaseClient();
  const { data: location, error: locationError } = await userClient
    .from('locations')
    .select('id')
    .eq('code', locationCode)
    .single<{ id: string }>();

  if (locationError || !location) {
    return { ok: false, error: 'That location could not be found.' };
  }

  const service = createServiceSupabaseClient();

  // Guard against re-inviting someone who already has an account/profile so a
  // rollback can never delete a live user.
  const existingUserId = await findAuthUserIdByEmail(service, email);
  if (existingUserId) {
    const { data: existingProfile } = await service
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', existingUserId)
      .maybeSingle();
    return {
      ok: false,
      error: existingProfile
        ? 'That email already has an account.'
        : 'That email was already invited but has not finished signing up.',
    };
  }

  const redirectTo = process.env.NEXT_PUBLIC_INVENTORY_APP_URL
    ? `${process.env.NEXT_PUBLIC_INVENTORY_APP_URL}/auth/callback`
    : undefined;

  const { data: invited, error: inviteError } =
    await service.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteError || !invited.user) {
    return { ok: false, error: 'Could not send the invitation. Please try again.' };
  }

  const persisted = await persistManagerProfile(service, invited.user.id, {
    displayName,
    locationId: location.id,
    financeDiscountLimitPercent,
    permissions,
  });

  if (!persisted.ok) {
    return {
      ok: false,
      error: persisted.orphanUserId
        ? `${persisted.error} Auth user ${persisted.orphanUserId} needs manual removal.`
        : persisted.error,
    };
  }

  const audit = await recordAuditEvent(
    {
      eventType: 'MANAGER_INVITED',
      entityType: 'user_profile',
      entityId: invited.user.id,
      details: { email, displayName, locationCode, permissions, financeDiscountLimitPercent },
      locationId: location.id,
    },
    userClient,
  );

  revalidatePath('/settings/users');
  return {
    ok: true,
    message: audit.ok
      ? `Invitation sent to ${email}.`
      : `Invitation sent to ${email}, but the audit record failed — check server logs.`,
  };
}

/**
 * Sets a Manager's positive-discount cap (0–100) or clears it (`null`). The cap
 * is not a permission: `discounts.apply` must still be granted separately, and no
 * finance permission is granted here.
 */
export async function setManagerDiscountCapAction(
  userId: string,
  rawPercent: string,
): Promise<UsersActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can change discount caps.' };
  }

  const parsed = DiscountCapSchema.safeParse(rawPercent.trim());
  if (!parsed.success) {
    return { ok: false, error: 'Enter a percentage between 0 and 100, or leave it blank.' };
  }
  const percent = parsed.data;

  const service = createServiceSupabaseClient();
  const { data: target, error: targetError } = await service
    .from('user_profiles')
    .select('user_id, role, location_id')
    .eq('user_id', userId)
    .single<{ user_id: string; role: string; location_id: string | null }>();

  if (targetError || !target || target.role !== 'manager') {
    return { ok: false, error: 'That Manager could not be found.' };
  }

  const { error } = await service
    .from('user_profiles')
    .update({
      finance_discount_limit_percent: percent,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) {
    return { ok: false, error: 'Could not update the discount cap.' };
  }

  const userClient = await createServerSupabaseClient();
  await recordAuditEvent(
    {
      eventType: 'MANAGER_DISCOUNT_CAP_UPDATED',
      entityType: 'user_profile',
      entityId: userId,
      details: { financeDiscountLimitPercent: percent },
      locationId: target.location_id,
    },
    userClient,
  );

  revalidatePath('/settings/users');
  return {
    ok: true,
    message: percent === null ? 'Discount cap cleared.' : `Discount cap set to ${percent}%.`,
  };
}

export async function setManagerActiveAction(
  userId: string,
  active: boolean,
): Promise<UsersActionResult> {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    return { ok: false, error: 'Only Admins can change Manager access.' };
  }

  const service = createServiceSupabaseClient();
  const { data: target, error: targetError } = await service
    .from('user_profiles')
    .select('user_id, role, location_id')
    .eq('user_id', userId)
    .single<{ user_id: string; role: string; location_id: string | null }>();

  if (targetError || !target || target.role !== 'manager') {
    return { ok: false, error: 'That Manager could not be found.' };
  }

  const { error } = await service
    .from('user_profiles')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) {
    return { ok: false, error: 'Could not update Manager access.' };
  }

  const userClient = await createServerSupabaseClient();
  await recordAuditEvent(
    {
      eventType: active ? 'MANAGER_ENABLED' : 'MANAGER_DISABLED',
      entityType: 'user_profile',
      entityId: userId,
      locationId: target.location_id,
    },
    userClient,
  );

  revalidatePath('/settings/users');
  return {
    ok: true,
    message: active ? 'Manager re-enabled.' : 'Manager disabled.',
  };
}
