/**
 * Promotes an already-created Supabase Auth user to the first Admin.
 *
 * Usage:
 *   1. Create the Auth user in the Supabase dashboard (or `supabase` CLI).
 *   2. BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_NAME="Your Name" \
 *      npx tsx scripts/bootstrap-admin.ts
 *
 * This script never creates or prints a password and only ever writes an Admin
 * `user_profiles` row (role=admin, location_id=null).
 */
import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const email = requireEnv('BOOTSTRAP_ADMIN_EMAIL').trim().toLowerCase();
  const displayName = requireEnv('BOOTSTRAP_ADMIN_NAME').trim();

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let userId: string | undefined;
  for (let page = 1; page <= 20 && !userId; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    userId = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    )?.id;
    if (data.users.length < 200) break;
  }

  if (!userId) {
    throw new Error(
      `No Auth user found for ${email}. Create the user first, then re-run.`,
    );
  }

  const { error } = await supabase.from('user_profiles').upsert(
    {
      user_id: userId,
      display_name: displayName,
      role: 'admin',
      location_id: null,
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) throw error;

  process.stdout.write(`Admin profile ready for ${email} (${userId}).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `bootstrap-admin failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
