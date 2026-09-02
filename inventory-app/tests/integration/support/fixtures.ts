import { randomUUID } from 'node:crypto';

import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

export const REQUIRED_ENV = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
] as const;

/** Production project refs that integration tests must never touch. */
const FORBIDDEN_PROJECT_REFS = [
  'ezedirsnhtbaxselqeao',
  'afefdlvepdbtaxoscwew',
] as const;

export function missingEnv(): string[] {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

const PASSWORD = 'InventoryPhase1!Fixture123';

type PermissionKey = string;

export type TestTenants = {
  service: SupabaseClient;
  anon: () => SupabaseClient;
  admin: SupabaseClient;
  lon: SupabaseClient;
  reg: SupabaseClient;
  adminUser: User;
  lonUser: User;
  regUser: User;
  lonLocationId: string;
  regLocationId: string;
  cleanup: () => Promise<void>;
};

/**
 * Provisions an Admin, a LON Manager, and a REG Manager in the local/disposable
 * Supabase project and returns signed-in anon clients for each. `cleanup()`
 * deletes the Auth users (and their cascaded rows) in teardown.
 */
export async function createTestTenants(options: {
  lonPermissions?: PermissionKey[];
  regPermissions?: PermissionKey[];
}): Promise<TestTenants> {
  const url = process.env.SUPABASE_TEST_URL!;
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!;

  if (FORBIDDEN_PROJECT_REFS.some((ref) => url.includes(ref))) {
    throw new Error('Refusing to run destructive fixtures against a production project.');
  }
  if (process.env.SUPABASE_TEST_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error('Set SUPABASE_TEST_ALLOW_DESTRUCTIVE=true for a disposable project.');
  }

  const runId = randomUUID().slice(0, 8);
  const anon = () =>
    createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: `inv-fixture-${randomUUID()}`,
      },
    });
  const service = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const createdUserIds: string[] = [];

  async function makeUser(label: string): Promise<{ email: string; user: User }> {
    const email = `inv-fixture-${runId}-${label}@example.test`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error('user create failed');
    createdUserIds.push(data.user.id);
    return { email, user: data.user };
  }

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = anon();
    const { error } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (error) throw error;
    return client;
  }

  const { data: locations, error: locationError } = await service
    .from('locations')
    .select('id, code')
    .in('code', ['LON', 'REG']);
  if (locationError || !locations || locations.length !== 2) {
    throw locationError ?? new Error('expected LON and REG locations');
  }
  const lonLocationId = locations.find((l) => l.code === 'LON')!.id;
  const regLocationId = locations.find((l) => l.code === 'REG')!.id;

  const adminAcct = await makeUser('admin');
  const lonAcct = await makeUser('lon');
  const regAcct = await makeUser('reg');

  const { error: profileError } = await service.from('user_profiles').insert([
    { user_id: adminAcct.user.id, display_name: 'Fixture Admin', role: 'admin', location_id: null },
    { user_id: lonAcct.user.id, display_name: 'Fixture LON', role: 'manager', location_id: lonLocationId },
    { user_id: regAcct.user.id, display_name: 'Fixture REG', role: 'manager', location_id: regLocationId },
  ]);
  if (profileError) throw profileError;

  const permissionRows = [
    ...(options.lonPermissions ?? []).map((permission_key) => ({
      user_id: lonAcct.user.id,
      permission_key,
      enabled: true,
    })),
    ...(options.regPermissions ?? []).map((permission_key) => ({
      user_id: regAcct.user.id,
      permission_key,
      enabled: true,
    })),
  ];
  if (permissionRows.length > 0) {
    const { error } = await service.from('manager_permissions').insert(permissionRows);
    if (error) throw error;
  }

  const admin = await signIn(adminAcct.email);
  const lon = await signIn(lonAcct.email);
  const reg = await signIn(regAcct.email);

  return {
    service,
    anon,
    admin,
    lon,
    reg,
    adminUser: adminAcct.user,
    lonUser: lonAcct.user,
    regUser: regAcct.user,
    lonLocationId,
    regLocationId,
    async cleanup() {
      await Promise.allSettled([
        admin.auth.signOut(),
        lon.auth.signOut(),
        reg.auth.signOut(),
        ...createdUserIds.map((id) => service.auth.admin.deleteUser(id)),
      ]);
    },
  };
}
