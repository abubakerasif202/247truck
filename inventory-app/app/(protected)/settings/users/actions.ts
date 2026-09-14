'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentAccess } from '@/lib/auth/access';
import { isManagerGrantablePermission } from '@/lib/auth/permission-keys';
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

/** Finds an existing Auth user id without an arbitrary account-count ceiling. */
async function findAuthUserIdByEmail(
  service: ReturnType<typeof createServiceSupabaseClient>,
  email: string,
): Promise<string | null> {
  for (let page = 1; ; page += 1) {
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

  const { data: operationId, error: operationError } = await userClient.rpc(
    'admin_begin_manager_invitation',
    {
      p_email: email,
      p_desired_profile: {
        display_name: displayName,
        location_id: location.id,
        finance_discount_limit_percent: financeDiscountLimitPercent,
        permissions,
      },
    },
  );
  if (operationError || !operationId) {
    return { ok: false, error: 'An invitation for that email is already pending or could not be started.' };
  }

  // Guard against re-inviting someone who already has an account/profile so a
  // rollback can never delete a live user.
  const existingUserId = await findAuthUserIdByEmail(service, email);
  if (existingUserId) {
    const { data: existingProfile } = await service
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', existingUserId)
      .maybeSingle();
    await userClient.rpc('admin_set_invitation_compensation', {
      p_operation_id: operationId,
      p_auth_user_id: existingUserId,
      p_compensated: true,
      p_error_code: 'ACCOUNT_ALREADY_EXISTS',
    });
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
    await userClient.rpc('admin_set_invitation_compensation', {
      p_operation_id: operationId,
      p_auth_user_id: null,
      p_compensated: true,
      p_error_code: 'AUTH_INVITE_FAILED',
    });
    return { ok: false, error: 'Could not send the invitation. Please try again.' };
  }

  const { error: completeError } = await userClient.rpc('admin_complete_manager_invitation', {
    p_operation_id: operationId,
    p_auth_user_id: invited.user.id,
  });
  if (completeError) {
    const { error: deleteError } = await service.auth.admin.deleteUser(invited.user.id);
    await userClient.rpc('admin_set_invitation_compensation', {
      p_operation_id: operationId,
      p_auth_user_id: invited.user.id,
      p_compensated: !deleteError,
      p_error_code: deleteError ? 'AUTH_COMPENSATION_FAILED' : 'DATABASE_TRANSACTION_FAILED',
    });
    return {
      ok: false,
      error: deleteError
        ? 'The invitation could not be completed and requires Admin recovery.'
        : 'The invitation could not be completed and was safely cancelled.',
    };
  }

  revalidatePath('/settings/users');
  return {
    ok: true,
    message: `Invitation sent to ${email}.`,
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

  const userClient = await createServerSupabaseClient();
  const { error } = await userClient.rpc('admin_update_manager', {
    p_user_id: userId,
    p_active: null,
    p_discount_cap: percent,
    p_update_discount: true,
  });

  if (error) {
    return { ok: false, error: 'Could not update the discount cap.' };
  }

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

  const userClient = await createServerSupabaseClient();
  const { error } = await userClient.rpc('admin_update_manager', {
    p_user_id: userId,
    p_active: active,
    p_discount_cap: null,
    p_update_discount: false,
  });

  if (error) {
    return { ok: false, error: 'Could not update Manager access.' };
  }

  revalidatePath('/settings/users');
  return {
    ok: true,
    message: active ? 'Manager re-enabled.' : 'Manager disabled.',
  };
}
