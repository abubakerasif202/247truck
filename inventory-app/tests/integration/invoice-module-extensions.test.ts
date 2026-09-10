import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const run = missingEnv().length === 0 ? describe : describe.skip;

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const PERMISSIONS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue', 'invoices.cancel', 'discounts.apply', 'payments.view', 'payments.record', 'documents.send'];

run('production invoice module extensions', () => {
  let t: TestTenants;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMISSIONS });
    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: { customer_type: 'business', display_name: 'Lakhnoor Singh', company_name: 'Invoice Fixture Pty Ltd', abn: '51824753556', mobile: '0400000001', payment_terms: '7_days', street_address: '1 Test Street', suburb: 'Lonsdale', state: 'SA', postcode: '5160' },
    });
    expect(customer.error).toBeNull();
    customerId = customer.data.customer_id;
    // Configure the complete finance identity required before an invoice can be issued.
    // This uses the supported finance-settings RPC rather than bypassing financial guards.
    const finance = await t.admin.rpc('finance_settings_detail');
    expect(finance.error, JSON.stringify(finance.error)).toBeNull();

    const globalVersion = Number(finance.data.global?.version ?? 0);
    const locations = (finance.data.locations ?? []) as Array<{
      location_id: string;
      version: number;
    }>;
    const locationVersion = Number(
      locations.find((row) => row.location_id === t.lonLocationId)?.version ?? 0,
    );

    const globalSettings = await t.admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(),
      p_expected_version: globalVersion,
      p_location_id: null,
      p_settings: {
        business_name: '24/7 Truck Tyre Test Service',
        abn: '51824753556',
        address: {
          street_address: '1 Test Street',
          suburb: 'Lonsdale',
          state: 'SA',
          postcode: '5160',
          country: 'Australia',
        },
        phone: '0400000000',
        shared_email: 'accounts@example.test',
        logo_asset_path: null,
        logo_sha256: null,
        bank_instructions: null,
        invoice_footer: 'Development fixture only',
      },
    });

    expect(
      globalSettings.error,
      JSON.stringify(globalSettings.error),
    ).toBeNull();

    const branchSettings = await t.admin.rpc('update_finance_settings', {
      p_request_id: randomUUID(),
      p_expected_version: locationVersion,
      p_location_id: t.lonLocationId,
      p_settings: {
        branch_name: 'Lonsdale Test Branch',
        address: {
          street_address: '1 Test Street',
          suburb: 'Lonsdale',
          state: 'SA',
          postcode: '5160',
          country: 'Australia',
        },
        phone: '0400000000',
        contact_email: 'branch@example.test',
        document_footer: 'Development fixture only',
      },
    });

    expect(
      branchSettings.error,
      JSON.stringify(branchSettings.error),
    ).toBeNull();
  });


  async function createSample() {
    const beforeMovements = Number(sql('select count(*) from public.inventory_movements;'));
    const response = await t.lon.rpc('create_manual_invoice_v2', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: {
        customer_id: customerId, issue_date: '2026-08-17', due_date: '2026-08-24', payment_terms: '7_days', payment_method: 'bank_transfer',
        job_details: { registration: 'XS66KY', odometer_km: 958010, service_date: '2026-08-17', vehicle_or_fleet_id: 'Drive set tyres' },
        lines: [
          { line_type: 'labour', description: 'Greforce HD02 11R 22.5 Drive', quantity: '8', unit_price: '390.00', pricing_basis: 'exclusive', gst_treatment: 'taxable', tyre_details: { brand: 'Greforce', model: 'HD02', size: '11R 22.5', position: 'drive', quantity_fitted: 8 } },
          { line_type: 'labour', description: 'Steers rotation', quantity: '2', unit_price: '20.00', pricing_basis: 'exclusive', gst_treatment: 'taxable' },
        ],
      },
    });
    expect(response.error, JSON.stringify(response.error)).toBeNull();

    expect(Number(sql('select count(*) from public.inventory_movements;'))).toBe(beforeMovements);
    return response.data;
  }

  it('reproduces Invoice 10602 totals exactly using exclusive 10% GST and structured tyre/job fields', async () => {
    const sample = await createSample();
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: sample.invoice_id });
    expect(detail.error).toBeNull();
    const revision = detail.data.revisions[0];
    expect(Number(revision.subtotal_ex_gst)).toBe(3160);
    expect(Number(revision.gst_amount)).toBe(316);
    expect(Number(revision.total_incl_gst)).toBe(3476);
    expect(revision.job_details).toMatchObject({ registration: 'XS66KY', odometer_km: 958010, service_date: '2026-08-17' });
    expect(revision.lines[0].tyre_details).toMatchObject({ brand: 'Greforce', model: 'HD02', position: 'drive' });
  });

  it('supports GST-free and inclusive lines with deterministic cent totals', async () => {
    const result = await t.lon.rpc('create_manual_invoice_v2', {
      p_request_id: randomUUID(), p_location_id: t.lonLocationId,
      p_input: { customer_id: customerId, lines: [
        { line_type: 'labour', description: 'Inclusive taxable', quantity: '1', unit_price: '110.00', pricing_basis: 'inclusive', gst_treatment: 'taxable' },
        { line_type: 'labour', description: 'GST free', quantity: '1', unit_price: '50.00', pricing_basis: 'exclusive', gst_treatment: 'gst_free' },
      ] },
    });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: result.data.invoice_id });
    expect(Number(detail.data.revisions[0].subtotal_ex_gst)).toBe(150);
    expect(Number(detail.data.revisions[0].gst_amount)).toBe(10);
    expect(Number(detail.data.revisions[0].total_incl_gst)).toBe(160);
  });

  it('duplicates a draft idempotently and voids only an unpaid issued invoice', async () => {
    const sample = await createSample();
    const request = randomUUID();
    const copy = await t.lon.rpc('duplicate_invoice_draft', { p_request_id: request, p_invoice_id: sample.invoice_id });
    expect(copy.error, JSON.stringify(copy.error)).toBeNull();
    const replay = await t.lon.rpc('duplicate_invoice_draft', { p_request_id: request, p_invoice_id: sample.invoice_id });
    expect(replay.data.invoice_id).toBe(copy.data.invoice_id);
    const issued = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: sample.invoice_id, p_expected_version: 1 });
    expect(issued.error).toBeNull();
    const voided = await t.lon.rpc('void_issued_invoice', { p_request_id: randomUUID(), p_invoice_id: sample.invoice_id, p_expected_version: 2, p_reason: 'Development fixture only' });
    expect(voided.error, JSON.stringify(voided.error)).toBeNull();
    expect(voided.data).toMatchObject({ status: 'cancelled', voided: true });
  });

  it('searches structured registration and returns stable pagination metadata', async () => {
    await createSample();
    const result = await t.lon.rpc('invoice_summary_v2', { p_location_id: t.lonLocationId, p_source_type: 'manual', p_search: 'XS66KY', p_sort: 'total', p_direction: 'desc', p_offset: 0, p_limit: 10 });
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(result.data.total).toBeGreaterThanOrEqual(1);
    expect(result.data.rows[0]).toMatchObject({ customer_name: 'Lakhnoor Singh', total_incl_gst: 3476 });
    const excluded = await t.lon.rpc('invoice_summary_v2', { p_location_id: t.lonLocationId, p_source_type: 'job', p_search: 'XS66KY', p_offset: 0, p_limit: 10 });
    expect(excluded.error).toBeNull();
    expect(excluded.data).toMatchObject({ total: 0, rows: [] });
  });

  it('preserves exclusive GST and tyre metadata through draft edits and issued revisions', async () => {
    const sample = await createSample();
    const detail = await t.lon.rpc('invoice_detail', { p_invoice_id: sample.invoice_id });
    const lines = detail.data.revisions[0].lines.map((line: Record<string, unknown>) => ({
      id: line.id, line_type: 'product', description: line.description, quantity: String(line.quantity),
      unit_price: String(line.unit_price_ex_gst), pricing_basis: 'exclusive', gst_treatment: 'taxable', tyre_details: line.tyre_details,
    }));
    const edit = await t.lon.rpc('update_invoice_draft_v2', { p_request_id: randomUUID(), p_invoice_id: sample.invoice_id, p_expected_version: 1, p_input: { lines } });
    expect(edit.error).toBeNull();
    const issue = await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: sample.invoice_id, p_expected_version: 2 });
    expect(issue.error).toBeNull();
    const revised = await t.lon.rpc('revise_unpaid_invoice', { p_request_id: randomUUID(), p_invoice_id: sample.invoice_id, p_expected_version: 3, p_input: { revision_reason: 'Metadata regression', lines: [] } });
    expect(revised.error, JSON.stringify(revised.error)).toBeNull();
    const after = await t.lon.rpc('invoice_detail', { p_invoice_id: sample.invoice_id });
    expect(after.data.revisions).toHaveLength(2);
    for (const revision of after.data.revisions) {
      expect(Number(revision.total_incl_gst)).toBe(3476);
      expect(revision.job_details.registration).toBe('XS66KY');
      expect(revision.lines[0].tyre_details.brand).toBe('Greforce');
    }
  });

  it('enforces email revision relationships, branch isolation and immutable delivery history without sending mail', async () => {
    const sample = await createSample();
    const other = await createSample();
    const input = { p_invoice_id: sample.invoice_id, p_invoice_revision_id: sample.revision_id, p_recipient: 'accounts@example.test', p_sender: 'disabled', p_provider: 'disabled', p_delivery_state: 'disabled' };
    expect((await t.lon.rpc('record_invoice_email_delivery', input)).error).not.toBeNull();
    expect((await t.lon.rpc('issue_invoice', { p_request_id: randomUUID(), p_invoice_id: sample.invoice_id, p_expected_version: 1 })).error).toBeNull();
    expect((await t.reg.rpc('record_invoice_email_delivery', input)).error).not.toBeNull();
    expect((await t.lon.rpc('record_invoice_email_delivery', { ...input, p_invoice_revision_id: other.revision_id })).error).not.toBeNull();
    const recorded = await t.lon.rpc('record_invoice_email_delivery', input);
    expect(recorded.error).toBeNull();
    expect((await t.lon.from('invoice_email_deliveries').select('*')).error).not.toBeNull();
    expect(() => sql(`update public.invoice_email_deliveries set sender='changed' where id='${recorded.data.id}'`)).toThrow();
    expect(() => sql('truncate public.invoice_email_deliveries cascade')).toThrow();
    expect((await t.lon.rpc('create_manual_invoice_v2', { p_request_id: randomUUID(), p_location_id: t.regLocationId, p_input: { lines: [] } })).error).not.toBeNull();
  });

  it('enforces manager discount limits for both fixed and percentage discounts', async () => {
    for (const discount of [{ discount_type: 'percent', discount_value: '90' }, { discount_type: 'fixed', discount_value: '90' }]) {
      const result = await t.lon.rpc('create_manual_invoice_v2', { p_request_id: randomUUID(), p_location_id: t.lonLocationId,
        p_input: { lines: [{ line_type: 'labour', description: 'Discount cap', quantity: '1', unit_price: '100', pricing_basis: 'exclusive', ...discount, discount_reason: 'Test only' }] } });
      expect(result.error?.message).toContain('DISCOUNT_LIMIT_EXCEEDED');
    }
  });
});
