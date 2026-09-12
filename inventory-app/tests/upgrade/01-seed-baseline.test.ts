import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from '../integration/support/fixtures';
import { forceDueDate, fullPayment, issuedInvoice, seedFinanceSettings, sql } from '../integration/support/review-fixtures';

/**
 * Phase 1 of the upgrade-from-baseline harness (see
 * scripts/verify-migration-upgrade.sh). This file MUST run against a DB that
 * has every migration applied EXCEPT
 * 20260912120000_review_remediation_pagination_scope.sql -- the "reviewed
 * baseline". It seeds data using the functions as they existed at that
 * baseline (in particular the OLD `cancel_invoice`, whose idempotency
 * fingerprint includes generated data), then writes everything
 * 02-verify-upgrade.test.ts needs to test-results/upgrade-state.json.
 *
 * Deliberately does NOT call t.cleanup() -- the seeded Auth users, locations
 * data, and financial rows must survive into 02-verify-upgrade.test.ts, which
 * runs against the DB AFTER the migration is applied.
 */

const missing = missingEnv();
const gated = process.env.UPGRADE_HARNESS === '1';
const run = missing.length === 0 && gated ? describe : describe.skip;
if (missing.length) console.warn(`[upgrade/01-seed-baseline] skipped: missing ${missing.join(', ')}`);
if (!gated) console.warn('[upgrade/01-seed-baseline] skipped: set UPGRADE_HARNESS=1 to run this destructive harness step');

const PERMS = [
  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue', 'invoices.cancel',
  'payments.view', 'payments.record', 'payments.reverse',
  'refunds.create', 'receivables.view', 'documents.send', 'inventory.view',
];

const STATE_PATH = resolve(process.cwd(), 'test-results', 'upgrade-state.json');

run('Upgrade harness: seed baseline data (pre-20260912120000)', () => {
  let t: TestTenants;
  const runTag = `UPGRADE-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS });
    seedFinanceSettings(t);
  }, 60_000);

  afterAll(() => {
    // No t.cleanup(): the seeded users and rows must survive the migration
    // and be readable by 02-verify-upgrade.test.ts.
  });

  it('seeds invoices, cancellations, email deliveries, and products, then writes upgrade-state.json', async () => {
    // --- 3 issued invoices -------------------------------------------------
    const paidInvoice = await issuedInvoice(t, '100.00');
    const paidResult = await fullPayment(t, paidInvoice.id, paidInvoice.version, '100.00');
    expect(paidResult.version).toBeGreaterThan(paidInvoice.version);

    const partialInvoice = await issuedInvoice(t, '200.00');
    const partialPayment = await t.lon.rpc('record_invoice_payment', {
      p_request_id: randomUUID(), p_invoice_id: partialInvoice.id, p_expected_version: partialInvoice.version,
      p_tenders: [{ method: 'cash', amount: '50.00' }],
    });
    expect(partialPayment.error, JSON.stringify(partialPayment.error)).toBeNull();

    const unpaidInvoice = await issuedInvoice(t, '75.00');
    forceDueDate([unpaidInvoice.id], 'null');

    // --- a draft invoice -----------------------------------------------------
    const draftMade = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Baseline draft', quantity: '1', unit_price_incl_gst: '45.00' }] },
    });
    expect(draftMade.error, JSON.stringify(draftMade.error)).toBeNull();
    const draftInvoiceId = draftMade.data.invoice_id as string;

    // --- a paid invoice cancelled via the baseline (OLD) cancel_invoice: ----
    // pending-refund path, whose idempotency fingerprint includes generated
    // credit-note/refund data (that is the "legacy fingerprint" this harness
    // proves survives the migration).
    const cancelPendingInvoice = await issuedInvoice(t, '150.00');
    const cancelPendingPaid = await fullPayment(t, cancelPendingInvoice.id, cancelPendingInvoice.version, '150.00');
    const cancelPendingRequestId = randomUUID();
    const cancelPendingResult = await t.lon.rpc('cancel_invoice', {
      p_request_id: cancelPendingRequestId, p_invoice_id: cancelPendingInvoice.id, p_expected_version: cancelPendingPaid.version, p_reason: 'Baseline full refund',
    });
    expect(cancelPendingResult.error, JSON.stringify(cancelPendingResult.error)).toBeNull();
    expect(cancelPendingResult.data).toMatchObject({ status: 'issued', cancellation_pending: true });

    // --- an unpaid issued invoice cancelled (goes straight to 'cancelled') -
    const cancelDoneInvoice = await issuedInvoice(t, '60.00');
    const cancelDoneRequestId = randomUUID();
    const cancelDoneResult = await t.lon.rpc('cancel_invoice', {
      p_request_id: cancelDoneRequestId, p_invoice_id: cancelDoneInvoice.id, p_expected_version: cancelDoneInvoice.version, p_reason: 'Baseline unpaid cancel',
    });
    expect(cancelDoneResult.error, JSON.stringify(cancelDoneResult.error)).toBeNull();
    expect(cancelDoneResult.data).toMatchObject({ status: 'cancelled' });

    // --- two record_invoice_email_delivery rows on an issued revision ------
    const emailDetail = await t.lon.rpc('invoice_detail', { p_invoice_id: paidInvoice.id });
    expect(emailDetail.error, JSON.stringify(emailDetail.error)).toBeNull();
    const paidRevisionId = emailDetail.data.current_revision_id as string;
    const sentMessageId = `baseline-msg-${randomUUID()}`;
    const sentDelivery = await t.lon.rpc('record_invoice_email_delivery', {
      p_invoice_id: paidInvoice.id, p_invoice_revision_id: paidRevisionId, p_recipient: 'baseline-sent@example.test',
      p_sender: 'sales@example.test', p_provider: 'resend', p_delivery_state: 'sent', p_provider_message_id: sentMessageId,
    });
    expect(sentDelivery.error, JSON.stringify(sentDelivery.error)).toBeNull();
    const failedDelivery = await t.lon.rpc('record_invoice_email_delivery', {
      p_invoice_id: paidInvoice.id, p_invoice_revision_id: paidRevisionId, p_recipient: 'baseline-failed@example.test',
      p_sender: 'sales@example.test', p_provider: 'resend', p_delivery_state: 'failed', p_error_message: 'Provider rejected (baseline)',
    });
    expect(failedDelivery.error, JSON.stringify(failedDelivery.error)).toBeNull();

    // --- a handful of products with balances --------------------------------
    sql(`
      insert into public.products (name, category_code, selling_price_incl_gst, created_by)
      select '${runTag} ' || lpad(gs::text,2,'0'), 'rim_wheel', 60.00, '${t.adminUser.id}'
      from generate_series(1,5) gs;
    `);
    sql(`
      update public.inventory_balances b set on_hand=8, reserved=0, weighted_average_cost=22.5000
      from public.products p, public.locations l
      where b.product_id=p.id and b.location_id=l.id and p.name like '${runTag} %';
    `);

    // --- row counts (whole-table, to be diffed unchanged across the
    // migration boundary in 02-verify-upgrade.test.ts) ----------------------
    const counts = {
      invoices: sql('select count(*) from public.invoices'),
      invoice_revisions: sql('select count(*) from public.invoice_revisions'),
      payments: sql('select count(*) from public.payments'),
      credit_notes: sql('select count(*) from public.credit_notes'),
      refunds: sql('select count(*) from public.refunds'),
      finance_action_requests: sql('select count(*) from public.finance_action_requests'),
      invoice_email_deliveries: sql('select count(*) from public.invoice_email_deliveries'),
      audit_events: sql('select count(*) from public.audit_events'),
    };

    const state = {
      runTag,
      users: {
        adminEmail: `${t.adminUser.email}`,
        lonEmail: `${t.lonUser.email}`,
        regEmail: `${t.regUser.email}`,
        adminUserId: t.adminUser.id,
        lonUserId: t.lonUser.id,
        regUserId: t.regUser.id,
      },
      locations: { lonLocationId: t.lonLocationId, regLocationId: t.regLocationId },
      invoices: {
        paid: { id: paidInvoice.id, revisionId: paidRevisionId },
        partial: { id: partialInvoice.id },
        unpaid: { id: unpaidInvoice.id },
        draft: { id: draftInvoiceId },
        cancelledPendingRefund: {
          id: cancelPendingInvoice.id,
          requestId: cancelPendingRequestId,
          expectedVersion: cancelPendingPaid.version,
          reason: 'Baseline full refund',
          originalResult: cancelPendingResult.data,
        },
        cancelledDone: {
          id: cancelDoneInvoice.id,
          requestId: cancelDoneRequestId,
          expectedVersion: cancelDoneInvoice.version,
          reason: 'Baseline unpaid cancel',
          originalResult: cancelDoneResult.data,
        },
      },
      emailDeliveries: {
        sent: { recipient: 'baseline-sent@example.test', messageId: sentMessageId },
        failed: { recipient: 'baseline-failed@example.test' },
      },
      counts,
    };

    mkdirSync(resolve(process.cwd(), 'test-results'), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  }, 60_000);
});
