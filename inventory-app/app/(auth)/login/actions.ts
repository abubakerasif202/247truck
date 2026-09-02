'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAuditEvent } from '@/lib/auth/audit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

export type LoginState = {
  ok: false;
  error: string;
};

const INVALID_CREDENTIALS: LoginState = {
  ok: false,
  error: 'Email or password is incorrect.',
};

export async function loginAction(
  _prev: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return INVALID_CREDENTIALS;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return INVALID_CREDENTIALS;
  }

  await recordAuditEvent(
    {
      eventType: 'LOGIN_SUCCESS',
      entityType: 'session',
      entityId: data.user.id,
    },
    supabase,
  );

  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/login');
}

const ResetSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type ResetState = { ok: true; message: string } | { ok: false; error: string };

/**
 * Sends a password-reset email. Always reports success so an attacker cannot
 * enumerate which emails have accounts.
 */
export async function requestPasswordResetAction(
  _prev: ResetState | undefined,
  formData: FormData,
): Promise<ResetState> {
  const generic: ResetState = {
    ok: true,
    message: 'If that email has an account, a reset link is on its way.',
  };

  const parsed = ResetSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return generic;
  }

  const appUrl = process.env.NEXT_PUBLIC_INVENTORY_APP_URL ?? '';
  const supabase = await createServerSupabaseClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl}/auth/callback?next=/onboarding/set-password`,
  });

  return generic;
}
