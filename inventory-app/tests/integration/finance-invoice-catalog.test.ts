import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Catalog-only, fenced to the disposable local stack. */
function sql(query: string): string {
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

const STAFF_RPCS = [
  'create_invoice_from_job(uuid,uuid)',
  'complete_job_and_create_invoice(uuid,uuid,integer)',
  'create_manual_invoice(uuid,uuid,jsonb)',
  'update_invoice_draft(uuid,uuid,integer,jsonb)',
  'issue_invoice(uuid,uuid,integer)',
  'revise_unpaid_invoice(uuid,uuid,integer,jsonb)',
  'cancel_invoice(uuid,uuid,integer,text)',
  'invoice_summary(uuid,text,text,timestamptz,integer)',
  'eligible_jobs_for_invoice(uuid,text,integer)',
];

const PRIVATE_HELPERS = [
  'finance_completion_proof(uuid)',
  'finance_write_revision_lines(uuid,uuid,jsonb)',
  'finance_build_job_invoice(uuid)',
  'finance_issue_snapshots(uuid)',
  'finance_due_date(text,text)',
];

describe('Phase 4B catalog and ACL invariants', () => {
  it.each(STAFF_RPCS)('staff RPC %s is SECURITY DEFINER, empty search_path, authenticated-only', (signature) => {
    const value = sql(
      `select json_build_object('security',p.prosecdef,'path',p.proconfig @> array['search_path=""'],` +
        `'auth',has_function_privilege('authenticated',p.oid,'execute'),` +
        `'anon',has_function_privilege('anon',p.oid,'execute'),` +
        `'service',has_function_privilege('service_role',p.oid,'execute')) ` +
        `from pg_proc p where p.oid=to_regprocedure('public.${signature}');`,
    );
    expect(value).not.toBe('');
    expect(JSON.parse(value)).toEqual({ security: true, path: true, auth: true, anon: false, service: false });
  });

  it.each(PRIVATE_HELPERS)('private helper %s is executable by no exposed role', (signature) => {
    const value = sql(
      `select json_build_object(` +
        `'pub',has_function_privilege('public',p.oid,'execute'),` +
        `'anon',has_function_privilege('anon',p.oid,'execute'),` +
        `'auth',has_function_privilege('authenticated',p.oid,'execute'),` +
        `'service',has_function_privilege('service_role',p.oid,'execute')) ` +
        `from pg_proc p where p.oid=to_regprocedure('private.${signature}');`,
    );
    expect(JSON.parse(value)).toEqual({ pub: false, anon: false, auth: false, service: false });
  });

  it('keeps one-invoice-per-job authoritative at the database', () => {
    expect(
      sql(
        `select count(*) from pg_constraint where conrelid='public.invoices'::regclass and contype='u' ` +
          `and pg_get_constraintdef(oid) like '%job_id%';`,
      ),
    ).toBe('1');
  });

  it('adds exactly one Phase 4B migration and no later-slice tables', () => {
    expect(
      sql(
        "select count(*) from supabase_migrations.schema_migrations where version like '202609%' and name like '%phase_4b%';",
      ),
    ).toBe('1');
    expect(
      sql(
        "select count(*) from pg_tables where schemaname='public' and tablename in " +
          "('payments','payment_reversals','credit_notes','credit_note_lines','refunds','stripe_checkouts','provider_events','email_deliveries','email_delivery_attempts','reminder_deliveries');",
      ),
    ).toBe('0');
  });

  it('extends the finance action-request vocabulary without dropping 4A actions', () => {
    const def = sql(
      "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.finance_action_requests'::regclass and conname='finance_action_requests_action_check';",
    );
    for (const action of [
      'update_finance_settings',
      'create_invoice_from_job',
      'complete_job_and_create_invoice',
      'create_manual_invoice',
      'issue_invoice',
      'revise_unpaid_invoice',
      'cancel_invoice',
    ]) {
      expect(def).toContain(action);
    }
  });

  it('financial_documents stays tax-invoice only in 4B', () => {
    expect(
      sql(
        "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.financial_documents'::regclass and conname='financial_documents_document_type_check';",
      ),
    ).toContain('tax_invoice');
  });
});
