import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { cleanupFinanceSettings, issuedInvoice, seedFinanceSettings, sql } from './support/review-fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-email-send-requests] skipped: missing ${missing.join(', ')}`);

const INVOICE_PERMS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue'];
const SEND_PERMS = [...INVOICE_PERMS, 'documents.send'];

run('Review remediation: durable invoice e-mail send requests', () => {
  let t: TestTenants;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: SEND_PERMS, regPermissions: SEND_PERMS });
    seedFinanceSettings(t);
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    cleanupFinanceSettings();
    await t.cleanup();
  });

  async function issuedForSend(amount = '99.00') {
    const inv = await issuedInvoice(t, amount);
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: inv.id });
    expect(detail.error, JSON.stringify(detail.error)).toBeNull();
    return { ...inv, revisionId: detail.data.current_revision_id as string };
  }

  it('walks send -> reuse -> uncertain -> retry -> accepted -> already_recorded -> retry(denied) -> resend -> expired-retry, and reports latest status', async () => {
    const invoice = await issuedForSend();
    const recipient = `review-email-${randomUUID().slice(0, 8)}@example.test`;

    const first = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(first.error, JSON.stringify(first.error)).toBeNull();
    expect(first.data).toMatchObject({ state: 'pending', attempt_count: 1, reused: false, send_sequence: 1 });
    const firstId = first.data.id as string;

    const reused = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(reused.error).toBeNull();
    expect(reused.data).toMatchObject({ id: firstId, reused: true, attempt_count: 2 });

    const uncertain = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: firstId, p_outcome: 'uncertain', p_sender: 'sales@example.test' });
    expect(uncertain.error, JSON.stringify(uncertain.error)).toBeNull();
    expect(uncertain.data.state).toBe('uncertain');
    expect(sql(`select delivery_state from public.invoice_email_deliveries where send_request_id='${firstId}' order by attempted_at desc limit 1`)).toBe('uncertain');

    const retry = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'retry' });
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ id: firstId, reused: true });
    expect(retry.data.idempotency_key).toBe(first.data.idempotency_key);

    const providerMessageId = `msg-${randomUUID()}`;
    const accepted = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: firstId, p_outcome: 'accepted', p_sender: 'sales@example.test', p_provider_message_id: providerMessageId });
    expect(accepted.error, JSON.stringify(accepted.error)).toBeNull();
    expect(accepted.data.state).toBe('accepted');

    const alreadyRecorded = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: firstId, p_outcome: 'accepted', p_sender: 'sales@example.test', p_provider_message_id: providerMessageId });
    expect(alreadyRecorded.error).toBeNull();
    expect(alreadyRecorded.data.already_recorded).toBe(true);
    expect(sql(`select count(*) from public.invoice_email_deliveries where send_request_id='${firstId}'`)).toBe('2');

    const retryAfterAccepted = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'retry' });
    expect(retryAfterAccepted.error?.message).toBe('EMAIL_ALREADY_ACCEPTED');

    const resend = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'resend' });
    expect(resend.error, JSON.stringify(resend.error)).toBeNull();
    expect(resend.data).toMatchObject({ reused: false, send_sequence: 2 });
    expect(resend.data.id).not.toBe(firstId);
    expect(resend.data.idempotency_key).not.toBe(first.data.idempotency_key);
    const secondId = resend.data.id as string;

    sql(`update public.invoice_email_send_requests set key_expires_at=now()-interval '1 hour' where id='${secondId}'`);
    const expiredRetry = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'retry' });
    expect(expiredRetry.error?.message).toBe('EMAIL_RETRY_WINDOW_EXPIRED');

    const openSequence3 = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(openSequence3.error, JSON.stringify(openSequence3.error)).toBeNull();
    expect(openSequence3.data).toMatchObject({ reused: false, send_sequence: 3 });

    const status = await t.lon.rpc('invoice_email_send_status', { p_invoice_id: invoice.id });
    expect(status.error, JSON.stringify(status.error)).toBeNull();
    const rows = status.data as { recipient: string; send_sequence: number }[];
    const forRecipient = rows.filter((r) => r.recipient === recipient);
    expect(forRecipient).toHaveLength(1);
    expect(forRecipient[0].send_sequence).toBe(3);
  });

  it('rejects a draft invoice with INVOICE_NOT_ISSUED', async () => {
    const made = await t.lon.rpc('create_manual_invoice', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Draft only', quantity: '1', unit_price_incl_gst: '10.00' }] },
    });
    expect(made.error).toBeNull();
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: made.data.invoice_id });
    const draft = await t.lon.rpc('begin_invoice_email_send', {
      p_invoice_id: made.data.invoice_id, p_invoice_revision_id: detail.data.current_revision_id, p_recipient: 'draft@example.test', p_mode: 'send',
    });
    expect(draft.error?.message).toBe('INVOICE_NOT_ISSUED');
  });

  it('denies a user without documents.send', async () => {
    const noSend = await createTestTenants({ lonPermissions: INVOICE_PERMS });
    try {
      const invoice = await issuedForSend();
      const denied = await noSend.lon.rpc('begin_invoice_email_send', {
        p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: 'nosend@example.test', p_mode: 'send',
      });
      expect(denied.error?.message).toBe('ACCESS_DENIED');
    } finally {
      await noSend.cleanup();
    }
  });

  it("does not let another actor reuse or act on this invoice's send request; REG cannot act on a LON invoice", async () => {
    const invoice = await issuedForSend();
    const denied = await t.reg.rpc('begin_invoice_email_send', {
      p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: 'cross-branch@example.test', p_mode: 'send',
    });
    expect(denied.error?.message).toBe('ACCESS_DENIED');

    const deniedFinish = await t.reg.rpc('finish_invoice_email_send', { p_send_request_id: randomUUID(), p_outcome: 'accepted', p_sender: 'x@example.test', p_provider_message_id: 'm' });
    expect(deniedFinish.error?.message).toBe('EMAIL_REQUEST_NOT_FOUND');
  });
});
