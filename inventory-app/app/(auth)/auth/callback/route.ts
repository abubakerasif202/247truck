import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Landing point for Supabase invite and password-recovery email links. Exchanges
 * the one-time code for a session, then sends the user to set a password.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/onboarding/set-password';

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
