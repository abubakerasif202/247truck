import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[superseded-rpc-lockdown] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

/**
 * These eleven functions were each superseded by a distinctly-named,
 * differently-signed replacement the application actually calls (see
 * 20260919093000_revoke_superseded_rpc_authenticated_execute.sql). Most
 * sharply, record_invoice_email_delivery let any authenticated user holding
 * documents.send fabricate an "email delivered" audit record for any issued
 * invoice at their branch, unlinked to any real send attempt. This proves no
 * authenticated session -- Admin included -- can call the old functions
 * directly any more, and that the current prepare/finish send workflow they
 * were superseded by still works end to end.
 */
run('superseded RPCs reject authenticated execution', () => {
  let t: TestTenants;
  let customerId: string;
  let invoiceId: string;
  let invoiceRevisionId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['invoices.view', 'invoices.create', 'invoices.issue', 'documents.send'],
    });

    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: { customer_type: 'individual', display_name: 'Lockdown Test Customer', mobile: '0400000321', suburb: 'Lonsdale', state: 'SA', postcode: '5160' },
    });
    expect(customer.error).toBeNull();
    customerId = customer.data.customer_id;

    const invoice = await t.lon.rpc('create_manual_invoice_v2', {
      p_request_id: randomUUID(),
      p_location_id: t.lonLocationId,
      p_input: { customer_id: customerId, payment_terms: 'due_on_receipt', lines: [{ line_type: 'labour', description: 'Lockdown fixture line', quantity: 1, unit_price_incl_gst: 55 }] },
    });
    expect(invoice.error).toBeNull();
    invoiceId = invoice.data.invoice_id;
    invoiceRevisionId = invoice.data.revision_id;
    const issued = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: invoiceId, p_expected_version: 1 });
    expect(issued.error).toBeNull();
  });

  afterAll(async () => {
    if (t) {
      await t.service.from('invoices').delete().eq('id', invoiceId);
      await t.service.from('customers').delete().eq('id', customerId);
      await t.cleanup();
    }
  });

  it('rejects a fabricated invoice-email-delivery record from every authenticated role', async () => {
    const input = {
      p_invoice_id: invoiceId, p_invoice_revision_id: invoiceRevisionId, p_recipient: 'forged@example.test',
      p_sender: 'forged-sender@example.test', p_provider: 'resend', p_delivery_state: 'sent',
      p_provider_message_id: 'forged-message-id', p_error_message: null, p_retry_of: null,
    };
    for (const client of [t.lon, t.admin, t.anon()]) {
      const result = await client.rpc('record_invoice_email_delivery', input);
      expect(result.error).not.toBeNull();
    }
    const deliveries = sql(`select count(*) from public.invoice_email_deliveries where invoice_id='${invoiceId}' and recipient='forged@example.test';`);
    expect(deliveries).toBe('0');
  });

  // Ten other functions from the same era (create_manual_invoice,
  // update_invoice_draft, invoice_summary, customer_receivables,
  // post_inventory_movement, create_product, create_purchase_order,
  // set_product_selling_price, begin_invoice_email_send,
  // claim_invoice_email_send) are likewise unused by the application, each
  // superseded by a distinctly-named, differently-shaped successor. Every
  // call site (app/lib and test) has been migrated to its successor and
  // 20260919098000_revoke_remaining_obsolete_rpc_authenticated_execute.sql
  // revokes EXECUTE on all ten from public, anon, authenticated, AND
  // service_role -- service_role gets no special carve-out because each of
  // these resolves its actor via auth.uid() internally, which is null under
  // a service-role JWT, so a service_role grant would never have been a
  // usable escape hatch anyway (proven empirically during this hardening
  // pass). Five of the ten remain reachable as internal SECURITY DEFINER
  // dependencies of an active function (see that migration's comment) --
  // revoking authenticated does not affect those nested calls, since
  // Postgres evaluates them under the owning role, not the external caller.
  it('locks down all ten superseded functions: no EXECUTE for authenticated, anon, PUBLIC, or service_role', () => {
    const names = [
      'create_manual_invoice', 'update_invoice_draft', 'invoice_summary', 'customer_receivables',
      'post_inventory_movement', 'create_product', 'create_purchase_order', 'set_product_selling_price',
      'begin_invoice_email_send', 'claim_invoice_email_send',
    ];
    const stillGranted = sql(`
      select p.proname || ':' || r.rolename from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('authenticated'),('anon'),('service_role'),('public')) as r(rolename)
      where n.nspname = 'public' and p.proname in (${names.map((n) => `'${n}'`).join(',')})
      and has_function_privilege(r.rolename, p.oid, 'EXECUTE');
    `);
    expect(stillGranted).toBe('');
  });

  it('their supported replacements still have authenticated EXECUTE', () => {
    const replacements = [
      'create_manual_invoice_v2', 'update_invoice_draft_v2', 'invoice_summary_v2', 'customer_receivables_v2',
      'post_inventory_movement_with_notes', 'create_product_with_prices', 'create_purchase_order_draft',
      'set_product_prices', 'prepare_invoice_email_send',
    ];
    const ungranted = sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${replacements.map((n) => `'${n}'`).join(',')})
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
    `);
    expect(ungranted).toBe('');
  });

  it('the current prepare/finish invoice email workflow still works end to end', async () => {
    const begin = await t.lon.rpc('prepare_invoice_email_send', {
      p_invoice_id: invoiceId, p_invoice_revision_id: invoiceRevisionId, p_recipient: 'real-recipient@example.test', p_mode: 'send',
      p_payload_sha256: 'b'.repeat(64),
      p_provider_payload: { idempotencyKey: 'pending-durable-key', from: 'noreply@example.test', to: ['real-recipient@example.test'], subject: 'Invoice', html: '<p>Invoice</p>', attachment: { filename: 'invoice.pdf', contentBase64: 'AA==' } },
      p_claim_provider: false,
    });
    expect(begin.error).toBeNull();

    const finish = await t.lon.rpc('finish_invoice_email_send', {
      p_send_request_id: begin.data.id, p_outcome: 'accepted', p_sender: 'noreply@example.test',
      p_provider_message_id: 'real-message-id', p_error_message: null,
    });
    expect(finish.error).toBeNull();

    const deliveryState = sql(`select delivery_state from public.invoice_email_deliveries where invoice_id='${invoiceId}' and recipient='real-recipient@example.test';`);
    expect(deliveryState).toBe('sent');
  });
});
