import { createClient } from '@supabase/supabase-js';
import { test as setup } from '@playwright/test';

import { E2E_PASSWORD, E2E_USERS, requireE2EEnv, serviceClient } from './fixtures';

/**
 * Provisions the deterministic Phase 1 acceptance users in the disposable
 * Supabase project, then seeds one used truck-tyre product so the stock flows
 * have something to act on. Test/staging only — never production credentials.
 */
setup('provision E2E users and seed catalogue', async () => {
  const service = serviceClient();

  const { data: locations } = await service
    .from('locations')
    .select('id, code')
    .in('code', ['LON', 'REG']);
  const locationId = (code: string) =>
    locations?.find((l) => l.code === code)?.id ?? null;

  const { data: list } = await service.auth.admin.listUsers({ perPage: 200 });

  for (const user of Object.values(E2E_USERS)) {
    const existing = list?.users.find((u) => u.email === user.email);
    if (existing) {
      await service.auth.admin.deleteUser(existing.id);
    }

    const { data, error } = await service.auth.admin.createUser({
      email: user.email,
      password: E2E_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error(`create ${user.email} failed`);
    const userId = data.user.id;

    const { error: profileError } = await service.from('user_profiles').insert({
      user_id: userId,
      display_name: user.email,
      role: user.role,
      location_id: user.locationCode ? locationId(user.locationCode) : null,
    });
    if (profileError) throw profileError;

    if (user.permissions.length > 0) {
      const { error: permError } = await service.from('manager_permissions').insert(
        user.permissions.map((permission_key) => ({
          user_id: userId,
          permission_key,
          enabled: true,
        })),
      );
      if (permError) throw permError;
    }
  }

  // Seed catalogue products as the Admin (create_product needs an admin JWT).
  const { url } = requireE2EEnv();
  const anonKey =
    process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Missing anon key for E2E product seeding.');

  const admin = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await admin.auth.signInWithPassword({
    email: E2E_USERS.admin.email,
    password: E2E_PASSWORD,
  });
  if (signInError) throw signInError;

  const products: Record<string, unknown>[] = [
    {
      p_name: 'E2E New Line-Haul 315/80R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 690,
      p_tyre_condition: 'new',
      p_tyre_brand: 'E2E Brand',
      p_tyre_size: '315/80R22.5',
    },
    {
      p_name: 'E2E Used Casing 11R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 240,
      p_tyre_condition: 'used',
      p_tyre_brand: 'E2E Brand',
      p_tyre_size: '11R22.5',
    },
  ];
  for (const args of products) {
    const { error } = await admin.rpc('create_product', args);
    // Ignore "already exists" style errors on a re-run against a non-reset DB.
    if (error && !error.message.includes('duplicate')) {
      // create_product itself never rejects duplicates; a name clash is fine.
    }
  }
  await admin.auth.signOut();
});
