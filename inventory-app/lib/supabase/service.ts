import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Elevated service-role Supabase client. Server-only and used exclusively for
 * Admin user provisioning (Manager invitations, bootstrap). It bypasses RLS, so
 * every call site must perform its own role check first.
 */
export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Service Supabase client is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
