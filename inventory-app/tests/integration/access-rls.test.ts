import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REQUIRED_ENV = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
] as const;

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
const describeWithEnvironment = missingEnv.length === 0 ? describe : describe.skip;

if (missingEnv.length > 0) {
  process.stderr.write(
    `[inventory access RLS] skipped: missing ${missingEnv.join(', ')}; use a disposable/local Supabase project only.\n`,
  );
}

describeWithEnvironment('inventory identity and access RLS', () => {
  const testUrl = process.env.SUPABASE_TEST_URL!;
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!;
  const password = 'InventoryPhase1!Test123';
  const runId = randomUUID();

  let service: SupabaseClient;
  let anonymous: SupabaseClient;
  let adminClient: SupabaseClient;
  let lonClient: SupabaseClient;
  let regClient: SupabaseClient;
  let adminUser: User;
  let lonUser: User;
  let regUser: User;
  let lonLocationId: string;
  let regLocationId: string;
  let lonAuditId: string;

  const createdUserIds: string[] = [];

  function client() {
    return createClient(testUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createConfirmedUser(label: string) {
    const email = `inventory-rls-${runId}-${label}@example.test`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    expect(error).toBeNull();
    expect(data.user).not.toBeNull();
    createdUserIds.push(data.user!.id);
    return { email, user: data.user! };
  }

  async function signIn(email: string) {
    const signedInClient = client();
    const { error } = await signedInClient.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    return signedInClient;
  }

  beforeAll(async () => {
    expect(testUrl).not.toContain('ezedirsnhtbaxselqeao');
    expect(
      process.env.SUPABASE_TEST_ALLOW_DESTRUCTIVE,
      'Set SUPABASE_TEST_ALLOW_DESTRUCTIVE=true only for a disposable/local project.',
    ).toBe('true');

    service = createClient(testUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonymous = client();

    const { data: locations, error: locationError } = await service
      .from('locations')
      .select('id, code')
      .in('code', ['LON', 'REG']);
    expect(locationError).toBeNull();
    expect(locations).toHaveLength(2);
    lonLocationId = locations!.find(({ code }) => code === 'LON')!.id;
    regLocationId = locations!.find(({ code }) => code === 'REG')!.id;

    const admin = await createConfirmedUser('admin');
    const lon = await createConfirmedUser('lon');
    const reg = await createConfirmedUser('reg');
    adminUser = admin.user;
    lonUser = lon.user;
    regUser = reg.user;

    const { error: profileError } = await service.from('user_profiles').insert([
      {
        user_id: adminUser.id,
        display_name: 'RLS Test Admin',
        role: 'admin',
        location_id: null,
      },
      {
        user_id: lonUser.id,
        display_name: 'RLS Test LON Manager',
        role: 'manager',
        location_id: lonLocationId,
      },
      {
        user_id: regUser.id,
        display_name: 'RLS Test REG Manager',
        role: 'manager',
        location_id: regLocationId,
      },
    ]);
    expect(profileError).toBeNull();

    const { error: permissionError } = await service.from('manager_permissions').insert([
      { user_id: lonUser.id, permission_key: 'inventory.stock_out' },
      { user_id: regUser.id, permission_key: 'inventory.stock_in' },
    ]);
    expect(permissionError).toBeNull();

    adminClient = await signIn(admin.email);
    lonClient = await signIn(lon.email);
    regClient = await signIn(reg.email);

    const { data: lonAudit, error: lonAuditError } = await lonClient.rpc(
      'app_audit_event',
      {
        p_details: { test_run: runId },
        p_entity_id: lonUser.id,
        p_entity_type: 'session',
        p_event_type: 'LOGIN_SUCCESS',
        p_location_id: lonLocationId,
      },
    );
    expect(lonAuditError).toBeNull();
    lonAuditId = lonAudit as string;

    const { error: regAuditError } = await regClient.rpc('app_audit_event', {
      p_details: { test_run: runId },
      p_entity_id: regUser.id,
      p_entity_type: 'session',
      p_event_type: 'LOGIN_SUCCESS',
      p_location_id: regLocationId,
    });
    expect(regAuditError).toBeNull();
  });

  afterAll(async () => {
    if (!service) return;

    await service.from('locations').update({ active: true }).in('id', [lonLocationId, regLocationId]);

    await Promise.allSettled([
      adminClient?.auth.signOut(),
      lonClient?.auth.signOut(),
      regClient?.auth.signOut(),
    ]);

    for (const userId of createdUserIds.reverse()) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) throw error;
    }
  });

  it('denies anonymous table access', async () => {
    const { error } = await anonymous.from('locations').select('id');
    expect(error).not.toBeNull();
  });

  it('scopes locations by role and assigned branch', async () => {
    const [adminResult, lonResult, regResult] = await Promise.all([
      adminClient.from('locations').select('code').order('code'),
      lonClient.from('locations').select('code'),
      regClient.from('locations').select('code'),
    ]);

    expect(adminResult.error).toBeNull();
    expect(adminResult.data?.map(({ code }) => code)).toEqual(['LON', 'REG']);
    expect(lonResult.data?.map(({ code }) => code)).toEqual(['LON']);
    expect(regResult.data?.map(({ code }) => code)).toEqual(['REG']);
  });

  it('prevents Managers from reading other profiles, permissions, or audits', async () => {
    const [profiles, permissions, audits] = await Promise.all([
      lonClient.from('user_profiles').select('user_id'),
      lonClient.from('manager_permissions').select('user_id'),
      lonClient
        .from('audit_events')
        .select('actor_user_id, location_id')
        .eq('entity_id', lonUser.id),
    ]);

    expect(profiles.error).toBeNull();
    expect(profiles.data?.map(({ user_id }) => user_id)).toEqual([lonUser.id]);
    expect(permissions.error).toBeNull();
    expect(permissions.data?.map(({ user_id }) => user_id)).toEqual([lonUser.id]);
    expect(audits.error).toBeNull();
    expect(audits.data).toEqual([
      { actor_user_id: lonUser.id, location_id: lonLocationId },
    ]);
  });

  it('denies authenticated INSERT, UPDATE, and DELETE on identity tables', async () => {
    const results = [
      await lonClient.from('locations').insert({ code: 'LON', name: 'Rogue Depot' }),
      await adminClient.from('locations').insert({ code: 'LON', name: 'Rogue Depot' }),
      await lonClient.from('user_profiles').update({ role: 'admin' }).eq('user_id', lonUser.id),
      await adminClient.from('user_profiles').update({ role: 'admin' }).eq('user_id', lonUser.id),
      await lonClient.from('manager_permissions').update({ enabled: false }).eq('user_id', lonUser.id),
      await lonClient.from('locations').delete().eq('id', lonLocationId),
    ];

    for (const result of results) {
      expect(result.error).not.toBeNull();
    }
  });

  it('prevents a REG Manager from reading LON identity or audit rows', async () => {
    const [profiles, audits] = await Promise.all([
      regClient.from('user_profiles').select('user_id'),
      regClient
        .from('audit_events')
        .select('actor_user_id, location_id')
        .eq('entity_id', regUser.id),
    ]);

    expect(profiles.error).toBeNull();
    expect(profiles.data?.map(({ user_id }) => user_id)).toEqual([regUser.id]);
    expect(audits.error).toBeNull();
    expect(audits.data).toEqual([
      { actor_user_id: regUser.id, location_id: regLocationId },
    ]);
  });

  it('allows Admins to read both branches and all test access records', async () => {
    const [profiles, permissions, audits] = await Promise.all([
      adminClient.from('user_profiles').select('user_id').in('user_id', createdUserIds),
      adminClient.from('manager_permissions').select('user_id').in('user_id', [lonUser.id, regUser.id]),
      adminClient.from('audit_events').select('actor_user_id').in('entity_id', [lonUser.id, regUser.id]),
    ]);

    expect(profiles.data).toHaveLength(3);
    expect(permissions.data).toHaveLength(2);
    expect(audits.data).toHaveLength(2);
  });

  it('denies direct authenticated audit inserts, updates, and deletes', async () => {
    const insertResult = await lonClient.from('audit_events').insert({
      actor_user_id: lonUser.id,
      actor_role: 'manager',
      location_id: lonLocationId,
      event_type: 'LOGIN_SUCCESS',
      entity_type: 'session',
      details: { forged: true },
    });
    const updateResult = await lonClient
      .from('audit_events')
      .update({ details: { forged: true } })
      .eq('id', lonAuditId);
    const deleteResult = await lonClient.from('audit_events').delete().eq('id', lonAuditId);
    const serviceUpdateResult = await service
      .from('audit_events')
      .update({ details: { forged: true } })
      .eq('id', lonAuditId);
    const serviceDeleteResult = await service
      .from('audit_events')
      .delete()
      .eq('id', lonAuditId);

    expect(insertResult.error).not.toBeNull();
    expect(updateResult.error).not.toBeNull();
    expect(deleteResult.error).not.toBeNull();
    expect(serviceUpdateResult.error).not.toBeNull();
    expect(serviceDeleteResult.error).not.toBeNull();
  });

  it('prevents a Manager from forging another location or event type', async () => {
    const forgedLocation = await lonClient.rpc('app_audit_event', {
      p_details: {},
      p_entity_id: lonUser.id,
      p_entity_type: 'session',
      p_event_type: 'LOGIN_SUCCESS',
      p_location_id: regLocationId,
    });
    const forgedEvent = await lonClient.rpc('app_audit_event', {
      p_details: {},
      p_entity_id: lonUser.id,
      p_entity_type: 'stock_item',
      p_event_type: 'INVENTORY_ADJUSTED',
      p_location_id: lonLocationId,
    });

    expect(forgedLocation.error).not.toBeNull();
    expect(forgedEvent.error).not.toBeNull();
  });

  it('removes access when the profile or assigned location becomes inactive', async () => {
    const { error: disableProfileError } = await service
      .from('user_profiles')
      .update({ active: false })
      .eq('user_id', lonUser.id);
    expect(disableProfileError).toBeNull();
    expect((await lonClient.from('locations').select('id')).data).toEqual([]);

    const { error: enableProfileError } = await service
      .from('user_profiles')
      .update({ active: true })
      .eq('user_id', lonUser.id);
    expect(enableProfileError).toBeNull();

    const { error: disableLocationError } = await service
      .from('locations')
      .update({ active: false })
      .eq('id', lonLocationId);
    expect(disableLocationError).toBeNull();
    expect((await lonClient.from('locations').select('id')).data).toEqual([]);
  });
});
