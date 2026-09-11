import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

import type { TestTenants } from './fixtures';

/**
 * Shared helpers for the review-remediation regression tests
 * (tests/integration/review-*.test.ts). Mirrors the `sql()` / `issuedInvoice()`
 * conventions already used by finance-payments.test.ts and
 * finance-credit-refunds.test.ts.
 */

export function sql(query: string): string {
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

export function seedFinanceSettings(t: TestTenants): void {
  sql(`
    insert into public.finance_settings(singleton,business_name,abn,address,phone,shared_email,version,updated_by)
    values(true,'24/7 Truck Tyre Services','12345678901','{"street_address":"1 Test Rd","suburb":"Adelaide","state":"SA","postcode":"5000"}','0880000000','accounts@example.test',1,'${t.adminUser.id}')
    on conflict(singleton) do update set business_name=excluded.business_name,abn=excluded.abn,address=excluded.address,phone=excluded.phone,shared_email=excluded.shared_email;
    insert into public.finance_location_settings(location_id,branch_name,address,phone,contact_email,version,updated_by)
    values('${t.lonLocationId}','Lonsdale','{"street_address":"2 Test Rd","suburb":"Lonsdale","state":"SA","postcode":"5160"}','0881111111','lon@example.test',1,'${t.adminUser.id}'),
          ('${t.regLocationId}','Regency Park','{"street_address":"3 Test Rd","suburb":"Regency Park","state":"SA","postcode":"5010"}','0882222222','reg@example.test',1,'${t.adminUser.id}')
    on conflict(location_id) do update set branch_name=excluded.branch_name,address=excluded.address,phone=excluded.phone,contact_email=excluded.contact_email;
  `);
}

export function cleanupFinanceSettings(): void {
  sql('delete from public.finance_location_settings; delete from public.finance_settings;');
}

export type IssuedInvoice = { id: string; version: number };

/** Issues a walk-in-customer LON invoice (due_on_receipt terms => due_date === issue_date). */
export async function issuedInvoice(t: TestTenants, amount = '110.00', customerId: string | null = null): Promise<IssuedInvoice> {
  const made = await t.lon.rpc('create_manual_invoice', {
    p_request_id: randomUUID(),
    p_location_id: t.lonLocationId,
    p_input: {
      customer_id: customerId,
      payment_terms: 'due_on_receipt',
      lines: [{ line_type: 'labour', description: 'Workshop service', quantity: '1', unit_price_incl_gst: amount }],
    },
  });
  expect(made.error, JSON.stringify(made.error)).toBeNull();
  const issued = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: made.data.invoice_id, p_expected_version: 1 });
  expect(issued.error, JSON.stringify(issued.error)).toBeNull();
  return { id: made.data.invoice_id as string, version: Number(issued.data.version) };
}

/**
 * Creates a dedicated fixture customer (as Admin, who bypasses manager
 * permission checks) so a test's invoices can be isolated from whatever the
 * LON branch has accumulated across earlier, un-reset test runs.
 */
export async function makeFixtureCustomer(t: TestTenants, label: string): Promise<string> {
  const result = await t.admin.rpc('create_customer', {
    p_request_id: randomUUID(),
    p_customer: {
      customer_type: 'individual',
      display_name: `Review Fixture ${label} ${randomUUID().slice(0, 8)}`,
      mobile: '0412345678',
      suburb: 'Adelaide',
      state: 'SA',
      postcode: '5000',
    },
  });
  expect(result.error, JSON.stringify(result.error)).toBeNull();
  return result.data.customer_id as string;
}

const INVOICE_REVISIONS_CHECK1 =
  "check ((lifecycle <> 'issued') or (pricing_complete and issued_at is not null and issue_date is not null and due_date is not null))";

/**
 * Forces `due_date` on the invoice's *current* (already-issued) revision to an
 * arbitrary value (including null). Two independent protections stand in the
 * way and both are bypassed for this call only, never left disabled:
 *
 *  1. `invoice_revisions_guard` (trigger) raises FINANCE_HISTORY_IMMUTABLE for
 *     any update once lifecycle='issued'. Bypassed via
 *     `session_replication_role='replica'`, which (unlike
 *     `ALTER TABLE ... DISABLE TRIGGER`) is scoped to this one psql
 *     connection/invocation, not the whole database.
 *  2. `invoice_revisions_check1` requires `due_date is not null` whenever
 *     lifecycle='issued' — a plain CHECK constraint, which
 *     session_replication_role does NOT bypass. Nulling due_date on an issued
 *     row is therefore unreachable through any RPC or direct SQL short of
 *     dropping the constraint. It is dropped and immediately re-added
 *     `not valid` (so it does not re-validate the rows we deliberately
 *     violated, but still guards every future write) inside one transaction.
 */
export function forceDueDate(invoiceIds: string[], dueDateSql: string): void {
  if (invoiceIds.length === 0) return;
  const list = invoiceIds.map((id) => `'${id}'`).join(',');
  const needsConstraintBypass = dueDateSql.trim().toLowerCase() === 'null';
  sql(`
    begin;
    set local session_replication_role='replica';
    ${needsConstraintBypass ? 'alter table public.invoice_revisions drop constraint invoice_revisions_check1;' : ''}
    update public.invoice_revisions r set due_date=${dueDateSql}
    from public.invoices i where i.current_revision_id=r.id and i.id in (${list});
    ${needsConstraintBypass ? `alter table public.invoice_revisions add constraint invoice_revisions_check1 ${INVOICE_REVISIONS_CHECK1} not valid;` : ''}
    commit;
  `);
}

export async function fullPayment(t: TestTenants, invoiceId: string, version: number, amount: string): Promise<{ version: number; payment_ids: string[] }> {
  const result = await t.lon.rpc('record_invoice_payment', { p_request_id: randomUUID(), p_invoice_id: invoiceId, p_expected_version: version, p_tenders: [{ method: 'cash', amount }] });
  expect(result.error, JSON.stringify(result.error)).toBeNull();
  return result.data;
}
