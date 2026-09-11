import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { cleanupFinanceSettings, forceDueDate, fullPayment, issuedInvoice, makeFixtureCustomer, seedFinanceSettings } from './support/review-fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-invoice-overdue-filter] skipped: missing ${missing.join(', ')}`);

const INVOICE_PERMS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue'];
const PERMS = [...INVOICE_PERMS, 'payments.view', 'payments.record', 'payments.reverse', 'receivables.view'];

run('Review remediation: overdue is a financial condition, independent of partial payment', () => {
  let t: TestTenants;
  let customerId: string;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS, regPermissions: PERMS });
    seedFinanceSettings(t);
    customerId = await makeFixtureCustomer(t, 'overdue-filter');
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    cleanupFinanceSettings();
    await t.cleanup();
  });

  it('shows a partially paid, past-due invoice as overdue with payment_state partial', async () => {
    const invoice = await issuedInvoice(t, '200.00', customerId);
    forceDueDate([invoice.id], "current_date - 10");
    const paid = await fullPayment(t, invoice.id, invoice.version, '50.00');

    const overdue = await t.lon.rpc('invoice_summary_v2', {
      p_location_id: t.lonLocationId, p_status: 'overdue', p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 50,
    });
    expect(overdue.error, JSON.stringify(overdue.error)).toBeNull();
    const overdueRow = (overdue.data.rows as { id: string; display_status: string; payment_state: string }[]).find((r) => r.id === invoice.id);
    expect(overdueRow, 'expected the partially-paid past-due invoice to appear under p_status=overdue').toBeTruthy();
    expect(overdueRow).toMatchObject({ display_status: 'overdue', payment_state: 'partial' });

    const partial = await t.lon.rpc('invoice_summary_v2', {
      p_location_id: t.lonLocationId, p_status: 'partial', p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 50,
    });
    expect(partial.error).toBeNull();
    expect((partial.data.rows as { id: string }[]).some((r) => r.id === invoice.id)).toBe(true);

    const receivablesOverdue = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: customerId, p_state: 'overdue', p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 50,
    });
    expect(receivablesOverdue.error).toBeNull();
    expect((receivablesOverdue.data.rows as { invoice_id: string }[]).some((r) => r.invoice_id === invoice.id)).toBe(true);
    void paid;
  });

  it('does not list a fully-paid, past-due invoice as overdue', async () => {
    const invoice = await issuedInvoice(t, '80.00', customerId);
    forceDueDate([invoice.id], "current_date - 5");
    await fullPayment(t, invoice.id, invoice.version, '80.00');

    const overdue = await t.lon.rpc('invoice_summary_v2', {
      p_location_id: t.lonLocationId, p_status: 'overdue', p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 50,
    });
    expect(overdue.error).toBeNull();
    expect((overdue.data.rows as { id: string }[]).some((r) => r.id === invoice.id)).toBe(false);

    const paidStatus = await t.lon.rpc('invoice_summary_v2', {
      p_location_id: t.lonLocationId, p_status: 'paid', p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 50,
    });
    expect(paidStatus.error).toBeNull();
    const row = (paidStatus.data.rows as { id: string; display_status: string }[]).find((r) => r.id === invoice.id);
    expect(row).toMatchObject({ display_status: 'paid' });
  });

  it('enforces branch scope on invoice_summary_v2 and lets Admin scope to one branch or both', async () => {
    const cross = await t.reg.rpc('invoice_summary_v2', {
      p_location_id: t.lonLocationId, p_status: null, p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 10,
    });
    expect(cross.error?.message).toBe('ACCESS_DENIED');

    const adminScoped = await t.admin.rpc('invoice_summary_v2', {
      p_location_id: t.lonLocationId, p_status: null, p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 100,
    });
    expect(adminScoped.error).toBeNull();
    expect((adminScoped.data.rows as { location_id: string }[]).every((r) => r.location_id === t.lonLocationId)).toBe(true);

    const adminBoth = await t.admin.rpc('invoice_summary_v2', {
      p_location_id: null, p_status: null, p_source_type: null, p_search: null,
      p_sort: 'created_at', p_direction: 'desc', p_offset: 0, p_limit: 100,
    });
    expect(adminBoth.error).toBeNull();
    expect(adminBoth.data.total).toBeGreaterThanOrEqual(adminScoped.data.total);
  });
});
