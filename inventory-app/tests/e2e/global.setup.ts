import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
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
    const { data, error } = existing
      ? await service.auth.admin.updateUserById(existing.id, {
          password: E2E_PASSWORD,
          email_confirm: true,
        })
      : await service.auth.admin.createUser({
          email: user.email,
          password: E2E_PASSWORD,
          email_confirm: true,
        });
    if (error || !data.user) throw error ?? new Error(`create ${user.email} failed`);
    const userId = data.user.id;

    const { error: profileError } = await service.from('user_profiles').upsert(
      {
        user_id: userId,
        display_name: user.email,
        role: user.role,
        location_id: user.locationCode ? locationId(user.locationCode) : null,
        active: true,
      },
      { onConflict: 'user_id' },
    );
    if (profileError) throw profileError;

    const { error: clearPermissionsError } = await service
      .from('manager_permissions')
      .delete()
      .eq('user_id', userId);
    if (clearPermissionsError) throw clearPermissionsError;

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

  // Integration security suites deliberately finish with LON unassigned so
  // they can prove fail-closed behaviour. Browser acceptance has its own
  // deterministic topology: AWT sells from LON, while shared REG authorises
  // both businesses. Re-establish that state before exercising the UI.
  const { data: organizations, error: organizationsError } = await service
    .from('organizations')
    .select('id, code')
    .in('code', ['AWT', '247TRUCK']);
  if (organizationsError || !organizations || organizations.length !== 2) {
    throw organizationsError ?? new Error('E2E organizations are unavailable.');
  }
  const organizationId = (code: string) => organizations.find((item) => item.code === code)?.id;
  for (const assignment of [
    { organizationId: organizationId('AWT'), locationId: locationId('LON') },
    { organizationId: organizationId('AWT'), locationId: locationId('REG') },
    { organizationId: organizationId('247TRUCK'), locationId: locationId('REG') },
  ]) {
    if (!assignment.organizationId || !assignment.locationId) throw new Error('E2E business assignment is incomplete.');
    const { error } = await admin.rpc('admin_assign_organization_location', {
      p_organization_id: assignment.organizationId,
      p_location_id: assignment.locationId,
      p_active: true,
    });
    if (error) throw error;
  }

  const products: Record<string, unknown>[] = [
    {
      p_name: 'E2E New Line-Haul 315/80R22.5',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 690,
      p_wholesale_price_incl_gst: 690,
      p_tyre_condition: 'new',
      p_tyre_brand: 'E2E Brand',
      p_tyre_size: '315/80R22.5',
    },
    {
      p_name: 'E2E Used Casing 11R22.5',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 240,
      p_wholesale_price_incl_gst: 240,
      p_tyre_condition: 'used',
      p_tyre_brand: 'E2E Brand',
      p_tyre_size: '11R22.5',
    },
    {
      p_name: 'E2E Sales Product 385/65R22.5',
      p_category_code: 'truck_tyre',
      p_retail_price_incl_gst: 720,
      p_wholesale_price_incl_gst: 720,
      p_tyre_condition: 'new',
      p_tyre_brand: 'E2E Sales Brand',
      p_tyre_size: '385/65R22.5',
    },
  ];
  for (const args of products) {
    // These are disposable named fixtures. Reuse them when Playwright is
    // invoked more than once instead of creating same-name catalogue rows.
    const { data: existing, error: lookupError } = await service
      .from('products')
      .select('id')
      .eq('name', String(args.p_name))
      .order('created_at', { ascending: true })
      .limit(1);
    if (lookupError) throw lookupError;
    let productId = existing?.[0]?.id as string | undefined;
    if (!productId) {
      const { data, error } = await admin.rpc('create_product_with_prices', args);
      if (error || !data) throw error ?? new Error(`create product ${String(args.p_name)} failed`);
      productId = data as string;
    }
    if (productId && args.p_name === 'E2E Sales Product 385/65R22.5' && !existing?.[0]?.id) {
      const { error: stockError } = await admin.rpc('post_inventory_movement_with_notes', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: locationId('LON'), p_quantity_delta: 10, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 300 , p_notes: null });
      if (stockError && !stockError.message.includes('IDEMPOTENCY')) throw stockError;
    }
  }
  await admin.auth.signOut();
});
