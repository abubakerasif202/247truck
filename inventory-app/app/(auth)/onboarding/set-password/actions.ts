'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/auth/audit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const SetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters.'),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });

export type SetPasswordState =
  | { ok: true }
  | { ok: false; error: string };

export async function setPasswordAction(
  _prev: SetPasswordState | undefined,
  formData: FormData,
): Promise<SetPasswordState> {
  const parsed = SetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please check your password.',
    };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: 'Your link has expired. Ask an Admin to resend the invitation.',
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, error: 'Could not set your password. Try again.' };
  }

  await recordAuditEvent(
    { eventType: 'PASSWORD_SET', entityType: 'session', entityId: user.id },
    supabase,
  );

  redirect('/dashboard');
}
