import { createClient } from '@supabase/supabase-js';

export const E2E_PASSWORD = 'Phase1E2E!password';

export const E2E_USERS = {
  admin: {
    email: 'inventory-admin@test.local',
    role: 'admin' as const,
    locationCode: null,
    permissions: [] as string[],
  },
  lon: {
    email: 'inventory-lon@test.local',
    role: 'manager' as const,
    locationCode: 'LON' as const,
    permissions: [
      'inventory.view',
      'inventory.stock_in',
      'inventory.stock_out',
      'inventory.adjust',
      'inventory.view_cost',
      'inventory.transfer_request',
      'reports.view_inventory_value',
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.manage_contacts',
      'customers.manage_vehicles',
      'quotes.view', 'quotes.create', 'quotes.edit', 'quotes.accept',
      'jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'pos.use',
    ],
  },
  reg: {
    email: 'inventory-reg@test.local',
    role: 'manager' as const,
    locationCode: 'REG' as const,
    permissions: [
      'inventory.view',
      'inventory.stock_in',
      'inventory.stock_out',
      'inventory.adjust',
      'inventory.transfer_request',
    ],
  },
};

export function requireE2EEnv() {
  const url = process.env.SUPABASE_TEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'E2E needs SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_ROLE_KEY (or the NEXT_PUBLIC_/SUPABASE_ equivalents) pointing at a disposable Supabase.',
    );
  }
  if (process.env.SUPABASE_TEST_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error('Set SUPABASE_TEST_ALLOW_DESTRUCTIVE=true — E2E creates and deletes Auth users.');
  }
  return { url, serviceRoleKey };
}

export function serviceClient() {
  const { url, serviceRoleKey } = requireE2EEnv();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
