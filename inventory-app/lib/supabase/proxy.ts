import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getSupabasePublicEnv } from './env';

const PUBLIC_PREFIXES = ['/login', '/auth', '/onboarding'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refreshes the Supabase auth session on every matched request and redirects
 * obviously-anonymous navigation to `/login`. Authorisation (role, permissions,
 * branch) is still enforced in every Server Component / Server Action — the Next
 * 16 docs are explicit that proxy alone is not a security boundary.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.search = '';
    const redirect = NextResponse.redirect(redirectUrl);
    // Preserve any cookies Supabase rotated while validating the (absent) session.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  // NOTE: an authenticated user visiting /login is intentionally NOT bounced to
  // /dashboard here — a disabled or mis-configured account is redirected to
  // /login by the protected layout and must be able to see it (and sign out).

  return response;
}
