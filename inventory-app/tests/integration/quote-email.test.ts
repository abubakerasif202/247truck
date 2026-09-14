import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[quote-email] skipped: missing ${missing.join(', ')}`);

run('quote email delivery state machine', () => {
  let t: TestTenants;
  let productId: string;
  let quoteId: string;
  let beforeStock = 0;

  beforeAll(async () => {
    t = await createTestTenants({ regPermissions: ['quotes.view', 'quotes.create', 'quotes.edit'] });
    const product = await t.admin.rpc('create_product', { p_name: `Quote email ${Date.now()}`, p_category_code: 'truck_tyre', p_selling_price_incl_gst: 230, p_tyre_condition: 'new', p_tyre_brand: 'Greforce', p_tyre_size: '11R22.5' });
    expect(product.error).toBeNull(); productId = product.data;
    const stocked = await t.admin.rpc('post_inventory_movement', { p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.regLocationId, p_quantity_delta: 3, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100 });
    expect(stocked.error).toBeNull();
    const before = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.regLocationId).single(); beforeStock = Number(before.data?.on_hand ?? 0);
    const quote = await t.reg.rpc('create_walk_in_quote', { p_request_id: randomUUID(), p_location_id: t.regLocationId, p_contact: { name: 'Alex Walk-in', email: 'alex@example.test' }, p_quote: {}, p_lines: [{ line_type: 'product', product_id: productId, quantity: 1 }] });
    expect(quote.error).toBeNull(); quoteId = quote.data.quote_id;
  });

  afterAll(async () => { if (t) { await t.service.from('quote_email_deliveries').delete().eq('quote_id', quoteId); await t.service.from('quote_email_send_requests').delete().eq('quote_id', quoteId); await t.service.from('quotes').delete().eq('id', quoteId); await t.service.from('products').delete().eq('id', productId); await t.cleanup(); } });

  it('stores the exact PDF payload, reuses retries, and marks sent only after acceptance', async () => {
    const payload = { idempotencyKey: 'pending-durable-key', to: ['alex@example.test'], subject: 'Quote REG-QUO', html: '<p>quote</p>', attachment: { filename: 'quote.pdf', contentBase64: Buffer.from('pdf').toString('base64') } };
    const first = await t.reg.rpc('prepare_quote_email_send', { p_quote_id: quoteId, p_recipient: 'alex@example.test', p_mode: 'send', p_payload_sha256: 'a'.repeat(64), p_provider_payload: payload, p_claim_provider: false });
    expect(first.error).toBeNull(); expect(first.data.reused).toBe(false);
    const retry = await t.reg.rpc('prepare_quote_email_send', { p_quote_id: quoteId, p_recipient: 'alex@example.test', p_mode: 'retry', p_payload_sha256: 'a'.repeat(64), p_provider_payload: payload, p_claim_provider: false });
    expect(retry.error).toBeNull(); expect(retry.data.id).toBe(first.data.id); expect(retry.data.idempotency_key).toBe(first.data.idempotency_key);
    const finished = await t.reg.rpc('finish_quote_email_send', { p_send_request_id: first.data.id, p_outcome: 'accepted', p_sender: 'quotes@example.test', p_provider_message_id: 'provider-quote-1' });
    expect(finished.error).toBeNull();
    const detail = await t.reg.rpc('quote_detail', { p_quote_id: quoteId });
    expect(detail.data.status).toBe('sent'); expect(Number(detail.data.lines[0].unit_price_incl_gst)).toBe(230);
    const after = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.regLocationId).single();
    expect(Number(after.data?.on_hand)).toBe(beforeStock);
  });

  it('rejects a duplicate accepted send but permits an intentional resend sequence', async () => {
    const payload = { idempotencyKey: 'pending-durable-key', to: ['alex@example.test'], subject: 'Quote REG-QUO', html: '<p>quote</p>', attachment: { filename: 'quote.pdf', contentBase64: Buffer.from('pdf').toString('base64') } };
    const duplicate = await t.reg.rpc('prepare_quote_email_send', { p_quote_id: quoteId, p_recipient: 'alex@example.test', p_mode: 'send', p_payload_sha256: 'a'.repeat(64), p_provider_payload: payload, p_claim_provider: false });
    expect(duplicate.error?.message).toContain('EMAIL_ALREADY_ACCEPTED');
    const resend = await t.reg.rpc('prepare_quote_email_send', { p_quote_id: quoteId, p_recipient: 'alex@example.test', p_mode: 'resend', p_payload_sha256: 'a'.repeat(64), p_provider_payload: payload, p_claim_provider: false });
    expect(resend.error).toBeNull(); expect(resend.data.send_sequence).toBe(2); expect(resend.data.idempotency_key).toBe(resend.data.provider_payload?.idempotencyKey);
  });
});
