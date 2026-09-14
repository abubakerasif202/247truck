import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Landing point for Supabase invite and password-recovery email links. Exchanges
 * the one-time code for a session, then sends the user to set a password.
 */
const DEFAULT_NEXT = '/onboarding/set-password';

/**
 * Only a same-origin, absolute path is a safe redirect target. A relative
 * path (`@evil.com`), a protocol-relative one (`//evil.com`), or a full URL
 * to another host must never be honoured — each would let the `next` query
 * parameter carry a signed-in user off this origin right after a real
 * invite/reset code is exchanged.
 */
export function resolveSafeNext(origin: string, requested: string | null): string {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) {
    return DEFAULT_NEXT;
  }
  try {
    const resolved = new URL(requested, origin);
    return resolved.origin === origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : DEFAULT_NEXT;
  } catch {
    return DEFAULT_NEXT;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = resolveSafeNext(origin, searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?reason=link-invalid`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?reason=link-expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
