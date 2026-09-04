import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[customers] skipped: missing ${missing.join(', ')}`);

const individual = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  customer_type: 'individual', display_name: 'Alex Driver', mobile: '0412 345 678',
  email: null, street_address: null, suburb: 'Lonsdale', state: 'SA', postcode: '5160',
  payment_terms: null, notes: null, ...overrides,
});
const business = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  customer_type: 'business', display_name: 'Southern Fleet Logistics', company_name: 'Southern Fleet Logistics',
  legal_name: null, abn: '51 824 753 556', phone: '(08) 8123 4567', billing_email: 'accounts@southern.test',
  accounts_email: null, street_address: '1 Transport Way', suburb: 'Regency Park', state: 'SA', postcode: '5010',
  payment_terms: '30_days', po_reference_required: true, notes: null, ...overrides,
});

run('Phase 3A customers, fleet contacts and vehicles', () => {
  let t: TestTenants;
  const created: string[] = [];
  beforeAll(async () => { t = await createTestTenants({ lonPermissions: ['customers.view','customers.create','customers.edit','customers.manage_contacts','customers.manage_vehicles'] }); });
  afterAll(async () => {
    if (t) {
      if (created.length) await t.service.from('customers').delete().in('id', created);
      await t.cleanup();
    }
  });

  async function create(client = t.admin, payload = individual(), requestId = randomUUID()) {
    const response = await client.rpc('create_customer', { p_request_id: requestId, p_customer: payload });
    if (!response.error && response.data?.customer_id) created.push(response.data.customer_id);
    return response;
  }

  it('creates individual and business customers with valid payment terms and atomic numbers', async () => {
    const [person, fleet] = await Promise.all([create(), create(t.admin, business())]);
    expect(person.error).toBeNull(); expect(fleet.error).toBeNull();
    expect(person.data.customer_number).toMatch(/^CUS-\d{6}$/);
    expect(fleet.data.customer_number).toMatch(/^CUS-\d{6}$/);
    expect(person.data.customer_number).not.toBe(fleet.data.customer_number);
    const detail = await t.admin.rpc('get_customer', { p_customer_id: person.data.customer_id });
    expect(detail.data.payment_terms).toBe('due_on_receipt');
    expect(detail.data.email).toBeNull();
  });

  it('validates required fields and payment terms while optional email remains optional', async () => {
    expect((await create(t.admin, individual({ mobile: '' }))).error?.message).toContain('CUSTOMER_MOBILE_REQUIRED');
    expect((await create(t.admin, individual({ payment_terms: '60_days' }))).error?.message).toContain('INVALID_PAYMENT_TERMS');
    expect((await create(t.admin, business({ abn: '' }))).error?.message).toContain('CUSTOMER_ABN_REQUIRED');
  });

  it('warns about possible duplicates without merging or rejecting', async () => {
    const first = await create(t.admin, individual({ display_name: 'Duplicate One', mobile: '0400 111 222' }));
    const second = await create(t.admin, individual({ display_name: 'Duplicate Two', mobile: '0400111222' }));
    expect(first.error).toBeNull(); expect(second.error).toBeNull();
    expect(second.data.customer_id).not.toBe(first.data.customer_id);
    expect(second.data.warnings).toContain('MATCHING_MOBILE');
  });

  it('replays identical create requests and rejects key reuse with a different payload', async () => {
    const key = randomUUID();
    const first = await create(t.admin, individual({ display_name: 'Idempotent Person', mobile: '0400 222 333' }), key);
    const replay = await create(t.admin, individual({ display_name: 'Idempotent Person', mobile: '0400 222 333' }), key);
    expect(replay.error).toBeNull(); expect(replay.data).toEqual(first.data);
    expect((await create(t.admin, individual({ display_name: 'Changed Person', mobile: '0400 222 333' }), key)).error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
  });

  it('updates, archives and reactivates without deleting the customer', async () => {
    const made = await create(); const id = made.data.customer_id;
    const updated = await t.admin.rpc('update_customer', { p_customer_id: id, p_expected_version: 1, p_customer: individual({ display_name: 'Alex Updated' }) });
    expect(updated.error).toBeNull(); expect(updated.data.version).toBe(2);
    expect((await t.admin.rpc('set_customer_active', { p_customer_id: id, p_active: false })).error).toBeNull();
    expect((await t.admin.rpc('get_customer', { p_customer_id: id })).data.active).toBe(false);
    expect((await t.admin.rpc('set_customer_active', { p_customer_id: id, p_active: true })).error).toBeNull();
  });

  it('supports multiple contacts and enforces one active primary contact', async () => {
    const made = await create(t.admin, business({ display_name: 'Contact Fleet', company_name: 'Contact Fleet', abn: '51824753556' }));
    const id = made.data.customer_id;
    const owner = await t.lon.rpc('add_customer_contact', { p_customer_id: id, p_contact: { first_name: 'Sam', last_name: 'Owner', mobile: '0411000001', primary_contact: true } });
    const accounts = await t.lon.rpc('add_customer_contact', { p_customer_id: id, p_contact: { first_name: 'Kim', last_name: 'Accounts', email: 'kim@example.test', billing_contact: true } });
    expect(owner.error).toBeNull(); expect(accounts.error).toBeNull();
    expect((await t.lon.rpc('add_customer_contact', { p_customer_id: id, p_contact: { first_name: 'Pat', primary_contact: true } })).error?.message).toContain('PRIMARY_CONTACT_EXISTS');
    expect((await t.lon.rpc('update_customer_contact', { p_contact_id: accounts.data.contact_id, p_contact: { first_name: 'Kimberley', billing_contact: true } })).error).toBeNull();
    expect((await t.lon.rpc('archive_customer_contact', { p_contact_id: accounts.data.contact_id })).error).toBeNull();
  });

  it('supports trucks, trailers and other vehicles with normalized registration search', async () => {
    const made = await create(); const id = made.data.customer_id;
    for (const [vehicle_type, registration, fleet_number] of [['truck','sa 12 ab','T-01'],['trailer','tr 99 zz','TRL-9'],['other','fork 1',null]]) {
      expect((await t.lon.rpc('add_customer_vehicle', { p_customer_id: id, p_vehicle: { vehicle_type, registration, fleet_number } })).error).toBeNull();
    }
    const search = await t.lon.rpc('search_customers', { p_query: 'SA12AB', p_filter: 'all', p_limit: 20 });
    expect(search.error).toBeNull(); expect(search.data.some((row: { id: string }) => row.id === id)).toBe(true);
    const fleetSearch = await t.lon.rpc('search_customers', { p_query: 'trl-9', p_filter: 'all', p_limit: 20 });
    expect(fleetSearch.data.some((row: { id: string }) => row.id === id)).toBe(true);
  });

  it('updates and archives a vehicle without hard deletion', async () => {
    const made = await create(); const id = made.data.customer_id;
    const vehicle = await t.lon.rpc('add_customer_vehicle', { p_customer_id: id, p_vehicle: { vehicle_type: 'truck', registration: 'ABC 123' } });
    expect((await t.lon.rpc('update_customer_vehicle', { p_vehicle_id: vehicle.data.vehicle_id, p_vehicle: { vehicle_type: 'truck', registration: 'ABC 124', make: 'Volvo' } })).error).toBeNull();
    expect((await t.lon.rpc('archive_customer_vehicle', { p_vehicle_id: vehicle.data.vehicle_id })).error).toBeNull();
    const detail = await t.lon.rpc('get_customer', { p_customer_id: id });
    expect(detail.data.vehicles.find((v: { id: string }) => v.id === vehicle.data.vehicle_id).active).toBe(false);
  });

  it('searches customer number, person, company, ABN, phone and email', async () => {
    const person = await create(t.admin, individual({ display_name: 'Searchable Driver', mobile: '+61 412 765 432', email: 'SEARCH@Example.test' }));
    const fleet = await create(t.admin, business({ display_name: 'Needle Transport', company_name: 'Needle Transport', abn: '53 004 085 616' }));
    for (const query of [person.data.customer_number, 'searchable', '0412765432', 'search@example.test', 'Needle', '53004085616']) {
      const result = await t.admin.rpc('search_customers', { p_query: query, p_filter: 'all', p_limit: 20 });
      expect(result.error).toBeNull(); expect(result.data.length).toBeGreaterThan(0);
    }
    expect(fleet.error).toBeNull();
  });

  it('enforces anon, inactive-user and permission-less manager denial at the RPC boundary', async () => {
    expect((await t.anon().rpc('search_customers', { p_query: '', p_filter: 'all', p_limit: 20 })).error).not.toBeNull();
    expect((await t.reg.rpc('search_customers', { p_query: '', p_filter: 'all', p_limit: 20 })).error?.message).toContain('ACCESS_DENIED');
    expect((await create(t.reg)).error?.message).toContain('ACCESS_DENIED');
    await t.service.from('user_profiles').update({ active: false }).eq('user_id', t.lonUser.id);
    expect((await t.lon.rpc('search_customers', { p_query: '', p_filter: 'all', p_limit: 20 })).error?.message).toContain('ACCESS_DENIED');
    await t.service.from('user_profiles').update({ active: true }).eq('user_id', t.lonUser.id);
  });

  it('denies direct sensitive-table access to authenticated callers', async () => {
    for (const table of ['customers','customer_contacts','customer_vehicles','customer_rpc_requests']) {
      expect((await t.lon.from(table).select('*')).error).not.toBeNull();
    }
  });

  it('attributes all mutation audit events and keeps audit history immutable', async () => {
    const made = await create(); const id = made.data.customer_id;
    await t.admin.rpc('set_customer_active', { p_customer_id: id, p_active: false });
    const { data: events } = await t.service.from('audit_events').select('actor_user_id,event_type').eq('entity_id', id);
    expect(events?.map((event) => event.event_type)).toEqual(expect.arrayContaining(['CUSTOMER_CREATED','CUSTOMER_ARCHIVED']));
    expect(events?.every((event) => event.actor_user_id === t.adminUser.id)).toBe(true);
    expect((await t.service.from('audit_events').delete().eq('entity_id', id)).error).not.toBeNull();
  });
});
