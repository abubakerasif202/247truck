import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { sql } from '../integration/support/review-fixtures';
import { PASSWORD } from '../integration/support/fixtures';

// Run after 01-seed-baseline at schema 20260912120000, then again after
// migration up. Compare every original field, allowing only additive columns.
const tables = [
  'products', 'inventory_balances', 'inventory_movements',
  'stock_transfers', 'stock_transfer_lines', 'stock_transfer_actions',
  'invoices', 'invoice_revisions', 'invoice_lines', 'payments',
  'payment_reversals', 'credit_notes', 'credit_note_lines', 'refunds',
  'finance_action_requests', 'invoice_email_deliveries',
  'invoice_email_send_requests', 'audit_events',
] as const;
const path = resolve('test-results/five-findings-upgrade-snapshot.json');

/** Same whole-table counts 01-seed-baseline records and 02-verify-upgrade diffs. */
function rowCounts() {
  return Object.fromEntries([
    'invoices', 'invoice_revisions', 'payments', 'credit_notes', 'refunds',
    'finance_action_requests', 'invoice_email_deliveries', 'audit_events',
  ].map((table) => [table, sql(`select count(*) from public.${table}`)]));
}
const phase = process.env.REMEDIATION_UPGRADE_PHASE;

describe('five findings: populated schema upgrade preserves original records', () => {
  it('captures or verifies every original field without rewriting history', async () => {
    expect(['seed', 'verify']).toContain(phase);
    const statePath = resolve('test-results/upgrade-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (phase === 'seed') {
      // This phase runs right after the first remediation migration and before
      // the rest. Prove that boundary changed no row counts, then (below)
      // re-record the counts after this phase's own writes so
      // 02-verify-upgrade.test.ts checks the second boundary the same way.
      expect(rowCounts(), 'row counts across the first migration boundary').toEqual(state.counts);
      const client = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await client.auth.signInWithPassword({ email: state.users.adminEmail, password: PASSWORD })).error).toBeNull();
      const productId = sql(`select id from public.products where name like '${state.runTag} %' order by id limit 1`);
      const movement = await client.rpc('post_inventory_movement', {
        p_request_id: randomUUID(), p_product_id: productId, p_location_id: state.locations.lonLocationId,
        p_quantity_delta: 3, p_movement_type: 'quick_stock_in', p_reason: null, p_inbound_unit_cost: 22.5,
        p_used_tyre_unit_id: null, p_source_type: 'upgrade-test', p_source_id: randomUUID(), p_supplier_name: null,
      });
      expect(movement.error, JSON.stringify(movement.error)).toBeNull();
      const created = await client.rpc('create_transfer_request', {
        p_source_location_id: state.locations.lonLocationId, p_destination_location_id: state.locations.regLocationId,
        p_notes: 'Upgrade preservation', p_lines: [{ product_id: productId, requested_quantity: 2 }],
      });
      expect(created.error, JSON.stringify(created.error)).toBeNull();
      const transferId = sql(`select id from public.stock_transfers where transfer_number='${created.data}'`);
      for (const rpc of ['submit_transfer_request', 'approve_transfer']) {
        const result = await client.rpc(rpc, { p_transfer_id: transferId });
        expect(result.error, JSON.stringify(result.error)).toBeNull();
      }
      const dispatched = await client.rpc('dispatch_transfer', { p_transfer_id: transferId, p_request_id: randomUUID() });
      expect(dispatched.error, JSON.stringify(dispatched.error)).toBeNull();
      const received = await client.rpc('receive_transfer', {
        p_transfer_id: transferId, p_request_id: randomUUID(), p_receipts: [{ product_id: productId, received_quantity: 2 }],
      });
      expect(received.error, JSON.stringify(received.error)).toBeNull();
      const email = await client.rpc('begin_invoice_email_send', {
        p_invoice_id: state.invoices.paid.id, p_invoice_revision_id: state.invoices.paid.revisionId,
        p_recipient: 'upgrade-pending@example.test', p_mode: 'send',
      });
      expect(email.error, JSON.stringify(email.error)).toBeNull();
    }
    const rows = Object.fromEntries(tables.map((table) => [table,
      JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.${table} t`)) as Record<string, unknown>[],
    ]));
    if (phase === 'seed') {
      expect(rows.invoices.length).toBeGreaterThan(0);
      expect(rows.payments.length).toBeGreaterThan(0);
      expect(rows.credit_notes.length).toBeGreaterThan(0);
      expect(rows.refunds.length).toBeGreaterThan(0);
      expect(rows.audit_events.length).toBeGreaterThan(0);
      expect(rows.inventory_movements.length).toBeGreaterThan(0);
      expect(rows.stock_transfer_actions.length).toBeGreaterThanOrEqual(2);
      expect(rows.invoice_email_send_requests.length).toBeGreaterThan(0);
      writeFileSync(path, JSON.stringify(rows));
      writeFileSync(statePath, JSON.stringify({ ...state, counts: rowCounts() }, null, 2));
      return;
    }
    const before = JSON.parse(readFileSync(path, 'utf8')) as typeof rows;
    for (const table of tables) {
      // Other regression suites may append their own fixtures between phases.
      // Every baseline row must still exist with every original field intact.
      expect(rows[table].length, table).toBeGreaterThanOrEqual(before[table].length);
      // JSON text comparison is independent of row ordering and column additions.
      const keys = Object.keys(before[table][0] ?? {}).sort();
      const canonical = (items: Record<string, unknown>[]) => items.map((row) =>
        JSON.stringify(Object.fromEntries(keys.map((key) => [key, row[key]]))),
      ).sort();
      expect(canonical(rows[table]), table).toEqual(expect.arrayContaining(canonical(before[table])));
    }
  }, 60_000);
});
