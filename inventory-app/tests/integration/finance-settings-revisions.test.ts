import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

/** Superuser SQL, fenced to the disposable local stack. */
function psql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: query, encoding: 'utf8' },
  ).trim();
}

const skip = missingEnv().length > 0;

describe.skipIf(skip)('Phase 4A settings, provider flags and revision safety', () => {
  let tenants: TestTenants;

  beforeAll(async () => {
    tenants = await createTestTenants({
      lonPermissions: ['invoices.view'],
      regPermissions: ['invoices.view', 'inventory.view_cost'],
    });
  });
  afterAll(async () => {
    // Remove seeded finance rows (append-only triggers require a bypass) before
    // the fixture deletes its Auth users referenced by invoices.created_by.
    psql(`set session_replication_role = replica;
      delete from public.audit_events where entity_type in ('finance_settings','invoice');
      delete from public.invoice_line_costs where invoice_line_id in (select id from public.invoice_lines where invoice_id in (select id from public.invoices where invoice_number like '%-INV-9000%'));
      delete from public.invoice_lines where invoice_id in (select id from public.invoices where invoice_number like '%-INV-9000%');
      delete from public.invoice_revisions where invoice_id in (select id from public.invoices where invoice_number like '%-INV-9000%');
      delete from public.invoices where invoice_number like '%-INV-9000%';
      delete from public.finance_action_requests where action='update_finance_settings';
      delete from public.finance_settings where singleton;
      set session_replication_role = origin;`);
    await tenants.cleanup();
  });

  it('keeps the three provider/automation flags off with no permanent CHECK lock', () => {
    // All three columns exist and default to false.
    expect(
      psql(`select count(*) from information_schema.columns where table_schema='public'
             and table_name='finance_settings' and column_name in
             ('stripe_enabled','email_automation_enabled','reminders_enabled') and column_default='false';`),
    ).toBe('3');
    // No CHECK (NOT flag) constraint permanently forbids activation.
    expect(
      psql(`select count(*) from pg_constraint
             where conrelid='public.finance_settings'::regclass and contype='c'
               and pg_get_constraintdef(oid) ~* 'not[[:space:]]+(stripe_enabled|email_automation_enabled|reminders_enabled)';`),
    ).toBe('0');
  });

  it('update_finance_settings is Admin-only and refuses provider activation keys', async () => {
    const request = randomUUID();
    const denied = await tenants.lon.rpc('update_finance_settings', {
      p_request_id: request,
      p_expected_version: 0,
      p_location_id: null,
      p_settings: { business_name: 'X' },
    });
    expect(denied.error?.message).toMatch(/ACCESS_DENIED/);

    for (const bad of [{ stripe_enabled: true }, { email_automation_enabled: true }, { reminders_enabled: true }, { resend_api_key: 'x' }]) {
      const res = await tenants.admin.rpc('update_finance_settings', {
        p_request_id: randomUUID(),
        p_expected_version: 0,
        p_location_id: null,
        p_settings: bad,
      });
      expect(res.error?.message).toMatch(/INVALID_FINANCE_INPUT/);
    }
  });

  it('enforces optimistic version and exact idempotent replay for settings', async () => {
    const request = randomUUID();
    const payload = {
      p_request_id: request,
      p_expected_version: 0,
      p_location_id: null,
      p_settings: { business_name: '24/7 Truck Tyre Services', abn: '12345678901' },
    };
    const first = await tenants.admin.rpc('update_finance_settings', payload);
    expect(first.error).toBeNull();
    expect(first.data.version).toBe(1);

    // Exact replay returns the same result.
    const replay = await tenants.admin.rpc('update_finance_settings', payload);
    expect(replay.error).toBeNull();
    expect(replay.data.version).toBe(1);

    // Same request id, different payload -> reuse rejected.
    const reused = await tenants.admin.rpc('update_finance_settings', {
      ...payload,
      p_settings: { business_name: 'Different' },
    });
    expect(reused.error?.message).toMatch(/IDEMPOTENCY_KEY_REUSED/);

    // Stale expected version -> conflict.
    const stale = await tenants.admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(),
      p_expected_version: 0,
      p_location_id: null,
      p_settings: { business_name: 'Newer' },
    });
    expect(stale.error?.message).toMatch(/FINANCE_VERSION_CONFLICT/);
  });

  it('locks issued revisions/lines and forbids revision after a first_payment_at fixture', () => {
    const invoice = randomUUID();
    const draftRev = randomUUID();
    const issuedRev = randomUUID();
    const admin = tenants.adminUser.id;
    const loc = tenants.lonLocationId;

    // Seed a manual invoice with one draft revision, then a second issued revision.
    psql(`begin;
      set constraints all deferred;
      insert into public.invoices(id,invoice_number,location_id,source_type,status,created_by)
        values('${invoice}','LON-INV-900001','${loc}','manual','issued','${admin}');
      insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,created_by)
        values('${draftRev}','${invoice}',1,'draft','${admin}');
      insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,created_by)
        values('${issuedRev}','${invoice}',2,'draft','${admin}');
      insert into public.invoice_lines(id,invoice_id,revision_id,position,line_type,description,quantity,unit_price_incl_gst,base_incl_gst,discount_amount,total_incl_gst,gst_amount,subtotal_ex_gst)
        values('${randomUUID()}','${invoice}','${issuedRev}',1,'labour','Service',1,110.00,110.00,0,110.00,10.00,100.00);
      update public.invoice_revisions set lifecycle='issued',issued_at=now(),issue_date=current_date,due_date=current_date,pricing_complete=true,total_incl_gst=110.00,subtotal_ex_gst=100.00,gst_amount=10.00 where id='${issuedRev}';
      update public.invoices set current_revision_id='${issuedRev}' where id='${invoice}';
      commit;`);

    // Revision numbers are monotonic per invoice.
    expect(psql(`select string_agg(revision_number::text,',' order by revision_number) from public.invoice_revisions where invoice_id='${invoice}';`)).toBe('1,2');

    // Issued revision cannot be updated or deleted.
    expect(() => psql(`update public.invoice_revisions set revision_reason='x' where id='${issuedRev}';`)).toThrow();
    expect(() => psql(`delete from public.invoice_revisions where id='${issuedRev}';`)).toThrow();
    expect(() => psql(`update public.invoice_lines set description='tampered' where revision_id='${issuedRev}';`)).toThrow();

    // Draft revision on the same invoice is still mutable.
    psql(`update public.invoice_revisions set revision_reason='wip' where id='${draftRev}';`);
    expect(psql(`select revision_reason from public.invoice_revisions where id='${draftRev}';`)).toBe('wip');

    // Set a controlled first_payment_at: financial revisions are then permanently blocked.
    psql(`update public.invoices set first_payment_at=now() where id='${invoice}';`);
    expect(() => psql(`update public.invoice_revisions set revision_reason='after-pay' where id='${draftRev}';`)).toThrow();
    expect(() => psql(`insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,created_by) values('${randomUUID()}','${invoice}',3,'draft','${admin}');`)).toThrow();
  });

  it('projects invoice_line_costs only with inventory.view_cost', async () => {
    // A cost row seeded against a labour line on a REG invoice.
    const invoice = randomUUID();
    const rev = randomUUID();
    const line = randomUUID();
    const admin = tenants.adminUser.id;
    psql(`begin; set constraints all deferred;
      insert into public.invoices(id,invoice_number,location_id,source_type,status,created_by)
        values('${invoice}','REG-INV-900002','${tenants.regLocationId}','manual','draft','${admin}');
      insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,created_by)
        values('${rev}','${invoice}',1,'draft','${admin}');
      insert into public.invoice_lines(id,invoice_id,revision_id,position,line_type,description,quantity)
        values('${line}','${invoice}','${rev}',1,'labour','Service',1);
      insert into public.invoice_line_costs(invoice_line_id,captured_quantity,capture_source)
        values('${line}',1,'not_applicable');
      update public.invoices set current_revision_id='${rev}' where id='${invoice}';
      commit;`);

    const withCost = await tenants.reg.rpc('invoice_cost_detail', { p_invoice_id: invoice });
    expect(withCost.error).toBeNull();
    expect(Array.isArray(withCost.data)).toBe(true);
    expect(withCost.data).toHaveLength(1);
    expect(withCost.data[0].captured_unit_cost).toBeNull();

    const noCostPerm = await tenants.lon.rpc('invoice_cost_detail', { p_invoice_id: invoice });
    expect(noCostPerm.error?.message).toMatch(/ACCESS_DENIED/);

    // LON manager cannot even see the REG invoice detail.
    const crossBranch = await tenants.lon.rpc('invoice_detail', { p_invoice_id: invoice });
    expect(crossBranch.error?.message).toMatch(/ACCESS_DENIED/);
  });
});
