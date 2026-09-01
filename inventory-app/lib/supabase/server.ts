import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getSupabasePublicEnv } from './env';

/**
 * User-scoped Supabase client for Server Components, Route Handlers, and Server
 * Actions. All reads/writes go through RLS as the signed-in user.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` was called from a Server Component render. Session cookie
          // refresh is handled by `proxy.ts`; safe to ignore here.
        }
      },
    },
  });
}
