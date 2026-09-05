import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const tables = ['finance_settings', 'finance_location_settings', 'invoices', 'invoice_revisions', 'invoice_lines', 'invoice_line_costs', 'finance_action_requests', 'financial_documents'];

/** Catalog-only queries, fenced to the disposable local stack before Docker access. */
function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') {
    throw new Error('LOCAL_SUPABASE_REQUIRED');
  }
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

describe('Phase 4A foundation catalog', () => {
  it.each(tables)('%s exists with RLS and no direct exposed-role privileges', (table) => {
    const result = sql(`select json_build_object('rls', c.relrowsecurity, 'exposed', exists(select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee=0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${table}';`);
    expect(result).not.toBe('');
    expect(JSON.parse(result)).toEqual({ rls: true, exposed: false });
  });
  it('does not install later-slice tables', () => {
    expect(sql("select count(*) from pg_tables where schemaname='public' and tablename in ('payments','payment_reversals','credit_notes','credit_note_lines','refunds','stripe_checkouts','provider_events','email_deliveries','email_delivery_attempts','reminder_deliveries');")).toBe('0');
  });
  it('extends the audit role without replacing the table', () => {
    expect(sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.audit_events'::regclass and conname='audit_events_actor_role_check';")).toContain('system');
  });
  it('has an enforced current-revision pointer at commit', () => {
    expect(sql("select count(*) from pg_trigger where tgrelid='public.invoices'::regclass and tgname='invoices_require_current_revision' and tgdeferrable and tginitdeferred;")).toBe('1');
  });
  it.each(['finance_settings_detail()', 'update_finance_settings(uuid,integer,uuid,jsonb)', 'invoice_detail(uuid)', 'invoice_cost_detail(uuid)'])('staff RPC %s is authenticated-only with an empty search path', (signature) => {
    const value = sql(`select json_build_object('security',p.prosecdef,'path',p.proconfig @> array['search_path=""'],'auth',has_function_privilege('authenticated',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute')) from pg_proc p where p.oid=to_regprocedure('public.${signature}');`);
    expect(value).not.toBe('');
    expect(JSON.parse(value)).toEqual({ security: true, path: true, auth: true, anon: false, service: false });
  });
});
