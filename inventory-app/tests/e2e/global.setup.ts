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
    {
      p_name: 'E2E Sales Product 385/65R22.5',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 720,
      p_tyre_condition: 'new',
      p_tyre_brand: 'E2E Sales Brand',
      p_tyre_size: '385/65R22.5',
    },
  ];
  for (const args of products) {
    const { data: productId, error } = await admin.rpc('create_product', args);
    // Ignore "already exists" style errors on a re-run against a non-reset DB.
    if (error && !error.message.includes('duplicate')) {
      // create_product itself never rejects duplicates; a name clash is fine.
    }
    if (productId && args.p_name === 'E2E Sales Product 385/65R22.5') {
      const { error: stockError } = await admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: locationId('LON'), p_quantity_delta: 10, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 300 });
      if (stockError && !stockError.message.includes('IDEMPOTENCY')) throw stockError;
    }
  }
  // Minimum finance identity so Phase 4B invoice issue is not blocked on config.
  const detail = await admin.rpc('finance_settings_detail');
  if (detail.data) {
    await admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(),
      p_expected_version: detail.data.global.version,
      p_location_id: null,
      p_settings: {
        business_name: '24/7 Truck Tyre Services', abn: '12345678901', phone: '0880000000',
        shared_email: 'accounts@e2e.test',
        address: { street_address: '1 HO Rd', suburb: 'Adelaide', state: 'SA', postcode: '5000', country: 'AU' },
        bank_instructions: null, logo_asset_path: null, logo_sha256: null, invoice_footer: 'Thank you',
      },
    });
    for (const branch of detail.data.locations as Array<{ location_id: string; version: number }>) {
      await admin.rpc('update_finance_settings', {
        p_request_id: randomUUID(),
        p_expected_version: branch.version,
        p_location_id: branch.location_id,
        p_settings: {
          branch_name: 'E2E Branch', phone: '0881111111', contact_email: 'branch@e2e.test',
          address: { street_address: '2 Branch Rd', suburb: 'Lonsdale', state: 'SA', postcode: '5160', country: 'AU' },
          document_footer: null,
        },
      });
    }
  }
  await admin.auth.signOut();
});
