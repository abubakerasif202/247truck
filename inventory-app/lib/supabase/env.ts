export type SupabasePublicEnv = {
  url: string;
  anonKey: string;
};

/**
 * Reads the public (browser-safe) Supabase configuration. Never returns the
 * service-role key — that lives only in `lib/supabase/service.ts`.
 */
export function getSupabasePublicEnv(): SupabasePublicEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  return { url, anonKey };
}
