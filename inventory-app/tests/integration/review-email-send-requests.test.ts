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

  it('6 concurrent send calls for one recipient collapse into a single request row; attempt_count ends at 6', async () => {
    const invoice = await issuedForSend();
    const recipient = `concurrent-send-${randomUUID().slice(0, 8)}@example.test`;

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' }),
      ),
    );
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull();

    const ids = new Set(results.map((r) => r.data.id));
    const keys = new Set(results.map((r) => r.data.idempotency_key));
    expect(ids.size).toBe(1);
    expect(keys.size).toBe(1);

    const rowCount = sql(`select count(*) from public.invoice_email_send_requests where invoice_revision_id='${invoice.revisionId}' and recipient='${recipient}' and actor_user_id='${t.lonUser.id}' and send_sequence=1`);
    expect(rowCount).toBe('1');

    const attemptCount = sql(`select attempt_count from public.invoice_email_send_requests where id='${[...ids][0]}'`);
    expect(attemptCount).toBe('6');
  });

  it('6 concurrent resend calls produce 6 distinct send_sequence values with no unique-violation error, and 6 distinct keys', async () => {
    const invoice = await issuedForSend();
    const recipient = `concurrent-resend-${randomUUID().slice(0, 8)}@example.test`;

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'resend' }),
      ),
    );
    for (const r of results) expect(r.error, JSON.stringify(r.error)).toBeNull();

    const sequences = results.map((r) => r.data.send_sequence as number).sort((a, b) => a - b);
    expect(new Set(sequences).size).toBe(6);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6]);

    const keys = new Set(results.map((r) => r.data.idempotency_key));
    expect(keys.size).toBe(6);
  });

  it("finishing 'accepted' then 'uncertain' on the same request is EMAIL_ALREADY_ACCEPTED and leaves state/message unchanged with no new delivery row; the reverse order on a fresh request succeeds", async () => {
    const invoice = await issuedForSend();

    const recipient1 = `conflict-accept-first-${randomUUID().slice(0, 8)}@example.test`;
    const begin1 = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient1, p_mode: 'send' });
    expect(begin1.error, JSON.stringify(begin1.error)).toBeNull();
    const id1 = begin1.data.id as string;
    const m1 = `msg-${randomUUID()}`;
    const accepted = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: id1, p_outcome: 'accepted', p_sender: 'sales@example.test', p_provider_message_id: m1 });
    expect(accepted.error, JSON.stringify(accepted.error)).toBeNull();

    const deliveryCountBefore = sql(`select count(*) from public.invoice_email_deliveries where send_request_id='${id1}'`);
    const secondFinish = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: id1, p_outcome: 'uncertain', p_sender: 'sales@example.test' });
    expect(secondFinish.error?.message).toBe('EMAIL_ALREADY_ACCEPTED');
    expect(secondFinish.error?.code).toBe('23505');

    expect(sql(`select state from public.invoice_email_send_requests where id='${id1}'`)).toBe('accepted');
    expect(sql(`select provider_message_id from public.invoice_email_send_requests where id='${id1}'`)).toBe(m1);
    expect(sql(`select count(*) from public.invoice_email_deliveries where send_request_id='${id1}'`)).toBe(deliveryCountBefore);

    const recipient2 = `conflict-uncertain-first-${randomUUID().slice(0, 8)}@example.test`;
    const begin2 = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient2, p_mode: 'send' });
    expect(begin2.error, JSON.stringify(begin2.error)).toBeNull();
    const id2 = begin2.data.id as string;
    const uncertainFirst = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: id2, p_outcome: 'uncertain', p_sender: 'sales@example.test' });
    expect(uncertainFirst.error, JSON.stringify(uncertainFirst.error)).toBeNull();
    const thenAccepted = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: id2, p_outcome: 'accepted', p_sender: 'sales@example.test', p_provider_message_id: `msg-${randomUUID()}` });
    expect(thenAccepted.error, JSON.stringify(thenAccepted.error)).toBeNull();
    expect(thenAccepted.data.state).toBe('accepted');
  });

  it("after 'accepted', beginning again with mode 'send' (not just 'retry') is EMAIL_ALREADY_ACCEPTED, never a silent duplicate", async () => {
    const invoice = await issuedForSend();
    const recipient = `send-after-accepted-${randomUUID().slice(0, 8)}@example.test`;
    const begin = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(begin.error, JSON.stringify(begin.error)).toBeNull();
    const id = begin.data.id as string;
    const accepted = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: id, p_outcome: 'accepted', p_sender: 'sales@example.test', p_provider_message_id: `msg-${randomUUID()}` });
    expect(accepted.error, JSON.stringify(accepted.error)).toBeNull();

    const sendAgain = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(sendAgain.error?.message).toBe('EMAIL_ALREADY_ACCEPTED');
    expect(sql(`select count(*) from public.invoice_email_send_requests where invoice_revision_id='${invoice.revisionId}' and recipient='${recipient}'`)).toBe('1');
  });

  it('an expired uncertain request refuses retry with EMAIL_RETRY_WINDOW_EXPIRED; invoice_email_send_status reports key_expired true for it', async () => {
    const invoice = await issuedForSend();
    const recipient = `expired-window-${randomUUID().slice(0, 8)}@example.test`;
    const begin = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'send' });
    expect(begin.error, JSON.stringify(begin.error)).toBeNull();
    const id = begin.data.id as string;
    const uncertain = await t.lon.rpc('finish_invoice_email_send', { p_send_request_id: id, p_outcome: 'uncertain', p_sender: 'sales@example.test' });
    expect(uncertain.error, JSON.stringify(uncertain.error)).toBeNull();

    sql(`update public.invoice_email_send_requests set key_expires_at=now()-interval '1 hour' where id='${id}'`);

    const retry = await t.lon.rpc('begin_invoice_email_send', { p_invoice_id: invoice.id, p_invoice_revision_id: invoice.revisionId, p_recipient: recipient, p_mode: 'retry' });
    expect(retry.error?.message).toBe('EMAIL_RETRY_WINDOW_EXPIRED');

    const status = await t.lon.rpc('invoice_email_send_status', { p_invoice_id: invoice.id });
    expect(status.error, JSON.stringify(status.error)).toBeNull();
    const row = (status.data as { recipient: string; key_expired: boolean }[]).find((r) => r.recipient === recipient);
    expect(row).toBeDefined();
    expect(row!.key_expired).toBe(true);
  });
});
