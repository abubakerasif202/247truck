import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { missingEnv, PASSWORD } from '../integration/support/fixtures';
import { sql } from '../integration/support/review-fixtures';

/**
 * Phase 2 of the upgrade-from-baseline harness (see
 * scripts/verify-migration-upgrade.sh). This file MUST run AFTER
 * 20260912120000_review_remediation_pagination_scope.sql has been applied on
 * top of the data 01-seed-baseline.test.ts seeded at the pre-migration
 * baseline. It never re-seeds; it only reads test-results/upgrade-state.json
 * and asserts the migration upgraded a database that already held that data.
 */

const missing = missingEnv();
const gated = process.env.UPGRADE_HARNESS === '1';
const STATE_PATH = resolve(process.cwd(), 'test-results', 'upgrade-state.json');
const stateExists = existsSync(STATE_PATH);
const run = missing.length === 0 && gated && stateExists ? describe : describe.skip;
if (missing.length) console.warn(`[upgrade/02-verify-upgrade] skipped: missing ${missing.join(', ')}`);
if (!gated) console.warn('[upgrade/02-verify-upgrade] skipped: set UPGRADE_HARNESS=1 to run this harness step');
if (gated && !stateExists) console.warn(`[upgrade/02-verify-upgrade] skipped: ${STATE_PATH} not found -- run 01-seed-baseline.test.ts first`);

type UpgradeState = {
  runTag: string;
  users: { adminEmail: string; lonEmail: string; regEmail: string; adminUserId: string; lonUserId: string; regUserId: string };
  locations: { lonLocationId: string; regLocationId: string };
  invoices: {
    paid: { id: string; revisionId: string };
    partial: { id: string };
    unpaid: { id: string };
    draft: { id: string };
    cancelledPendingRefund: { id: string; requestId: string; expectedVersion: number; reason: string; originalResult: Record<string, unknown> };
    cancelledDone: { id: string; requestId: string; expectedVersion: number; reason: string; originalResult: Record<string, unknown> };
  };
  emailDeliveries: { sent: { recipient: string; messageId: string }; failed: { recipient: string } };
  counts: Record<string, string>;
};

function makeAnonClient(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL!;
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: `upgrade-verify-${randomUUID()}` },
  });
}

run('Upgrade harness: verify the migration upgraded a database that already held baseline data', () => {
  let state: UpgradeState;
  let service: SupabaseClient;
  let lon: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as UpgradeState;
    service = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    lon = makeAnonClient();
    const lonSignIn = await lon.auth.signInWithPassword({ email: state.users.lonEmail, password: PASSWORD });
    expect(lonSignIn.error, JSON.stringify(lonSignIn.error)).toBeNull();
    admin = makeAnonClient();
    const adminSignIn = await admin.auth.signInWithPassword({ email: state.users.adminEmail, password: PASSWORD });
    expect(adminSignIn.error, JSON.stringify(adminSignIn.error)).toBeNull();
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([lon?.auth.signOut(), admin?.auth.signOut()]);
    if (service) {
      await Promise.allSettled([
        service.auth.admin.deleteUser(state.users.adminUserId),
        service.auth.admin.deleteUser(state.users.lonUserId),
        service.auth.admin.deleteUser(state.users.regUserId),
      ]);
    }
  });

  it('every recorded row count is unchanged across the migration boundary', () => {
    const after = {
      invoices: sql('select count(*) from public.invoices'),
      invoice_revisions: sql('select count(*) from public.invoice_revisions'),
      payments: sql('select count(*) from public.payments'),
      credit_notes: sql('select count(*) from public.credit_notes'),
      refunds: sql('select count(*) from public.refunds'),
      finance_action_requests: sql('select count(*) from public.finance_action_requests'),
      invoice_email_deliveries: sql('select count(*) from public.invoice_email_deliveries'),
      audit_events: sql('select count(*) from public.audit_events'),
    };
    expect(after).toEqual(state.counts);
  });

  it('legacy cancellation request ids replay via the compatibility path with deep-equal results, and finance_request_outcome finds them', async () => {
    const { cancelledPendingRefund, cancelledDone } = state.invoices;

    const replayPending = await lon.rpc('cancel_invoice', {
      p_request_id: cancelledPendingRefund.requestId, p_invoice_id: cancelledPendingRefund.id,
      p_expected_version: cancelledPendingRefund.expectedVersion, p_reason: cancelledPendingRefund.reason,
    });
    expect(replayPending.error, JSON.stringify(replayPending.error)).toBeNull();
    expect(replayPending.data).toEqual(cancelledPendingRefund.originalResult);

    const replayDone = await lon.rpc('cancel_invoice', {
      p_request_id: cancelledDone.requestId, p_invoice_id: cancelledDone.id,
      p_expected_version: cancelledDone.expectedVersion, p_reason: cancelledDone.reason,
    });
    expect(replayDone.error, JSON.stringify(replayDone.error)).toBeNull();
    expect(replayDone.data).toEqual(cancelledDone.originalResult);

    const outcomePending = await lon.rpc('finance_request_outcome', { p_request_id: cancelledPendingRefund.requestId });
    expect(outcomePending.error, JSON.stringify(outcomePending.error)).toBeNull();
    expect(outcomePending.data).toMatchObject({ found: true, action: 'cancel_invoice' });

    const outcomeDone = await lon.rpc('finance_request_outcome', { p_request_id: cancelledDone.requestId });
    expect(outcomeDone.error, JSON.stringify(outcomeDone.error)).toBeNull();
    expect(outcomeDone.data).toMatchObject({ found: true, action: 'cancel_invoice', invoice_status: 'cancelled' });
  });

  it("customer_receivables (old build args) returns a JSON array with the old build's fields, including partial+unpaid and excluding paid", async () => {
    const result = await lon.rpc('customer_receivables', {
      p_location_id: null, p_customer_id: null, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 50,
    });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(Array.isArray(result.data)).toBe(true);
    const rows = result.data as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const field of ['invoice_id', 'invoice_number', 'customer_name', 'due_date', 'balance', 'payment_state', 'is_overdue', 'aging_bucket', 'invoice_link_allowed']) {
        expect(row).toHaveProperty(field);
      }
    }
    const invoiceIds = rows.map((r) => r.invoice_id);
    expect(invoiceIds).toContain(state.invoices.partial.id);
    expect(invoiceIds).toContain(state.invoices.unpaid.id);
    expect(invoiceIds).not.toContain(state.invoices.paid.id);
  });

  it("invoice_summary_v2 (old build args) returns {rows,total} with the old build's fields", async () => {
    const result = await lon.rpc('invoice_summary_v2', {
      p_location_id: null, p_status: null, p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 25,
    });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(result.data).toHaveProperty('rows');
    expect(result.data).toHaveProperty('total');
    const rows = result.data.rows as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const field of ['id', 'invoice_number', 'status', 'display_status', 'payment_state', 'balance', 'total_incl_gst', 'due_date']) {
        expect(row).toHaveProperty(field);
      }
    }
  });

  it('record_invoice_email_delivery (old build path) still inserts post-migration; invoice_detail lists the pre-migration rows plus the new one', async () => {
    const { paid } = state.invoices;
    const newMessageId = `post-migration-msg-${randomUUID()}`;
    const newDelivery = await lon.rpc('record_invoice_email_delivery', {
      p_invoice_id: paid.id, p_invoice_revision_id: paid.revisionId, p_recipient: 'post-migration@example.test',
      p_sender: 'sales@example.test', p_provider: 'resend', p_delivery_state: 'sent', p_provider_message_id: newMessageId,
    });
    expect(newDelivery.error, JSON.stringify(newDelivery.error)).toBeNull();

    const detail = await lon.rpc('invoice_detail', { p_invoice_id: paid.id });
    expect(detail.error, JSON.stringify(detail.error)).toBeNull();
    const deliveries = detail.data.email_deliveries as { recipient: string; provider_message_id: string | null }[];
    const recipients = deliveries.map((d) => d.recipient);
    expect(recipients).toContain(state.emailDeliveries.sent.recipient);
    expect(recipients).toContain(state.emailDeliveries.failed.recipient);
    expect(recipients).toContain('post-migration@example.test');
    const found = deliveries.find((d) => d.recipient === state.emailDeliveries.sent.recipient);
    expect(found?.provider_message_id).toBe(state.emailDeliveries.sent.messageId);
  });

  it('the new begin_invoice_email_send / finish_invoice_email_send work on the same revision and reference send_request_id', async () => {
    const { paid } = state.invoices;
    const recipient = `new-flow-${randomUUID().slice(0, 8)}@example.test`;
    const begin = await lon.rpc('begin_invoice_email_send', { p_invoice_id: paid.id, p_invoice_revision_id: paid.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(begin.error, JSON.stringify(begin.error)).toBeNull();
    const requestId = begin.data.id as string;

    const finish = await lon.rpc('finish_invoice_email_send', {
      p_send_request_id: requestId, p_outcome: 'accepted', p_sender: 'sales@example.test', p_provider_message_id: `new-flow-${randomUUID()}`,
    });
    expect(finish.error, JSON.stringify(finish.error)).toBeNull();

    const deliveryRow = sql(`select send_request_id from public.invoice_email_deliveries where send_request_id='${requestId}' order by attempted_at desc limit 1`);
    expect(deliveryRow).toBe(requestId);
  });

  it("the raw inventory_product_summary view still selects for the LON manager (old build's inventory page), and inventory_summary_page returns the seeded products", async () => {
    const raw = await lon.from('inventory_product_summary').select('product_id, location_code').like('name', `${state.runTag} %`);
    expect(raw.error, JSON.stringify(raw.error)).toBeNull();
    expect((raw.data ?? []).length).toBeGreaterThan(0);
    expect((raw.data ?? []).every((r: { location_code: string }) => r.location_code === 'LON')).toBe(true);

    const page = await lon.rpc('inventory_summary_page', {
      p_location_code: null, p_product_id: null, p_search: state.runTag, p_category: null, p_tyre_condition: null,
      p_low_stock_only: false, p_include_archived: false, p_offset: 0, p_limit: 50,
    });
    expect(page.error, JSON.stringify(page.error)).toBeNull();
    expect(page.data.total_products).toBe(5);
  });

  it('cancel_invoice on a fresh issued invoice works with a new request id, and an identical retry replays', async () => {
    const made = await lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: state.locations.lonLocationId,
      p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Post-migration fresh cancel', quantity: '1', unit_price_incl_gst: '90.00' }] },
    });
    expect(made.error, JSON.stringify(made.error)).toBeNull();
    const issued = await lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: made.data.invoice_id, p_expected_version: 1 });
    expect(issued.error, JSON.stringify(issued.error)).toBeNull();

    const requestId = randomUUID();
    const first = await lon.rpc('cancel_invoice', {
      p_request_id: requestId, p_invoice_id: made.data.invoice_id, p_expected_version: issued.data.version, p_reason: 'Post-migration fresh cancel',
    });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(first.data).toMatchObject({ status: 'cancelled' });

    const retry = await lon.rpc('cancel_invoice', {
      p_request_id: requestId, p_invoice_id: made.data.invoice_id, p_expected_version: issued.data.version, p_reason: 'Post-migration fresh cancel',
    });
    expect(retry.error, JSON.stringify(retry.error)).toBeNull();
    expect(retry.data).toEqual(first.data);
  });
});
