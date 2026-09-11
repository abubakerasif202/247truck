import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { cleanupFinanceSettings, forceDueDate, fullPayment, issuedInvoice, makeFixtureCustomer, seedFinanceSettings, sql } from './support/review-fixtures';

type ReceivablesPage = {
  rows: { invoice_id: string; due_date: string | null; location_code: string }[];
  has_more: boolean;
  next_cursor: { due_date: string | null; invoice_id: string } | null;
};

async function fetchPage(
  t: TestTenants,
  customerId: string | null,
  cursorDue: string | null,
  cursorId: string | null,
): Promise<{ error: { message: string } | null; data: ReceivablesPage | null }> {
  return t.lon.rpc('customer_receivables_v2', {
    p_location_id: t.lonLocationId, p_customer_id: customerId, p_state: null, p_search: null,
    p_due_from: null, p_due_to: null, p_cursor_due_date: cursorDue, p_cursor_invoice_id: cursorId, p_limit: 20,
  });
}

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[review-receivables-pagination] skipped: missing ${missing.join(', ')}`);

const INVOICE_PERMS = ['invoices.view', 'invoices.create', 'invoices.edit', 'invoices.issue'];
const PERMS = [...INVOICE_PERMS, 'payments.view', 'payments.record', 'payments.reverse', 'receivables.view'];

run('Review remediation: customer_receivables_v2 keyset pagination', () => {
  let t: TestTenants;
  let customerId: string;
  // The full set of unpaid issued invoices created for the pagination walk.
  const datedIds: string[] = [];
  const nullDueIds: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS, regPermissions: PERMS });
    seedFinanceSettings(t);
    // Scoped to a dedicated fixture customer so the walk below is exact even
    // though the LON branch accumulates invoices across un-reset test runs.
    customerId = await makeFixtureCustomer(t, 'receivables-paging');

    // due_on_receipt always resolves to due_date === issue_date, so a batch
    // of same-day invoices collides on due_date by construction.
    const DATED_COUNT = 55;
    const NULL_COUNT = 6;
    for (let i = 0; i < DATED_COUNT; i += 1) {
      const inv = await issuedInvoice(t, '55.00', customerId);
      datedIds.push(inv.id);
    }
    for (let i = 0; i < NULL_COUNT; i += 1) {
      const inv = await issuedInvoice(t, '55.00', customerId);
      nullDueIds.push(inv.id);
    }
    forceDueDate(nullDueIds, 'null');
  }, 120_000);

  afterAll(async () => {
    if (!t) return;
    cleanupFinanceSettings();
    await t.cleanup();
  });

  it('walks every page with no missing/duplicate rows, null-due rows trailing, and a null-due cursor', async () => {
    const expectedIds = new Set([...datedIds, ...nullDueIds]);
    const seen: string[] = [];
    let cursorDue: string | null = null;
    let cursorId: string | null = null;
    let hasMore = true;
    let sawNullCursor = false;
    let sawDatedAfterNull = false;
    let inNullSection = false;
    let pages = 0;

    while (hasMore) {
      pages += 1;
      expect(pages).toBeLessThan(20);
      const res = await fetchPage(t, customerId, cursorDue, cursorId);
      expect(res.error, JSON.stringify(res.error)).toBeNull();
      const page = res.data!;
      for (const row of page.rows) {
        if (row.due_date === null) inNullSection = true;
        else if (inNullSection) sawDatedAfterNull = true;
        seen.push(row.invoice_id);
      }
      hasMore = page.has_more;
      if (hasMore) {
        expect(page.next_cursor).not.toBeNull();
        cursorDue = page.next_cursor!.due_date;
        cursorId = page.next_cursor!.invoice_id;
        if (cursorDue === null) sawNullCursor = true;
      }
    }

    expect(sawDatedAfterNull).toBe(false);
    // Every row we created must appear exactly once, with nothing missing or duplicated.
    expect(seen).toHaveLength(expectedIds.size);
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(expectedIds);
    // At least one cursor must address the trailing null-due section.
    expect(sawNullCursor).toBe(true);
  });

  it('returns the same first page from the legacy array-returning signature', async () => {
    const v2 = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: customerId, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(v2.error).toBeNull();
    const legacy = await t.lon.rpc('customer_receivables', {
      p_location_id: t.lonLocationId, p_customer_id: customerId, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(legacy.error).toBeNull();
    expect(legacy.data).toEqual(v2.data.rows);
  });

  it('excludes a fully paid invoice from the default view, includes it under p_state=paid, and keeps partial in the default view', async () => {
    // The LON branch accumulates issued invoices across many test runs (the
    // local stack is never reset), so an unscoped page could push these rows
    // past any given p_limit purely by UUID sort order. Scope with p_search
    // on the invoice_number so the assertion is independent of that history.
    const paidInvoice = await issuedInvoice(t, '75.00');
    await fullPayment(t, paidInvoice.id, paidInvoice.version, '75.00');
    const paidNumber = (await t.lon.rpc('invoice_detail', { p_invoice_id: paidInvoice.id })).data.invoice_number as string;

    const partialInvoice = await issuedInvoice(t, '90.00');
    await fullPayment(t, partialInvoice.id, partialInvoice.version, '30.00');
    const partialNumber = (await t.lon.rpc('invoice_detail', { p_invoice_id: partialInvoice.id })).data.invoice_number as string;

    const defaultPaid = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: null, p_state: null, p_search: paidNumber,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(defaultPaid.error).toBeNull();
    expect(defaultPaid.data.rows).toEqual([]);

    const defaultPartial = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: null, p_state: null, p_search: partialNumber,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(defaultPartial.error).toBeNull();
    expect((defaultPartial.data.rows as { invoice_id: string }[]).map((r) => r.invoice_id)).toEqual([partialInvoice.id]);

    const paidView = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: null, p_state: 'paid', p_search: paidNumber,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(paidView.error).toBeNull();
    expect((paidView.data.rows as { invoice_id: string }[]).map((r) => r.invoice_id)).toEqual([paidInvoice.id]);

    const paidViewMissesPartial = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: null, p_state: 'paid', p_search: partialNumber,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(paidViewMissesPartial.error).toBeNull();
    expect(paidViewMissesPartial.data.rows).toEqual([]);
  });

  it.each([
    [{ p_limit: 101 }, 'INVALID_LIMIT'],
    [{ p_limit: 0 }, 'INVALID_LIMIT'],
    [{ p_state: 'bogus' }, 'INVALID_RECEIVABLE_FILTER'],
    [{ p_due_from: '2030-01-01', p_due_to: '2020-01-01' }, 'INVALID_RECEIVABLE_FILTER'],
    [{ p_search: 'x'.repeat(101) }, 'INVALID_RECEIVABLE_FILTER'],
  ])('rejects invalid pagination/filter input %o', async (overrides, error) => {
    const res = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: null, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
      ...overrides,
    });
    expect(res.error?.message).toBe(error);
  });

  it('enforces branch scope: a Manager cannot pass another branch, Admin can scope or see both', async () => {
    const cross = await t.lon.rpc('customer_receivables_v2', {
      p_location_id: t.regLocationId, p_customer_id: null, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 20,
    });
    expect(cross.error?.message).toBe('ACCESS_DENIED');

    const adminScoped = await t.admin.rpc('customer_receivables_v2', {
      p_location_id: t.lonLocationId, p_customer_id: null, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 100,
    });
    expect(adminScoped.error).toBeNull();
    expect((adminScoped.data.rows as { location_code: string }[]).every((r) => r.location_code === 'LON')).toBe(true);

    const adminBoth = await t.admin.rpc('customer_receivables_v2', {
      p_location_id: null, p_customer_id: null, p_state: null, p_search: null,
      p_due_from: null, p_due_to: null, p_cursor_due_date: null, p_cursor_invoice_id: null, p_limit: 100,
    });
    expect(adminBoth.error).toBeNull();
    expect(adminBoth.data.rows.length).toBeGreaterThanOrEqual(adminScoped.data.rows.length);
  });
});

// Sanity: confirm the null-due forcing technique actually lands as expected,
// independent of the RPC under test — guards against a false pass if the
// session_replication_role bypass silently no-ops.
run('review-receivables-pagination: null due_date seeding sanity', () => {
  let t: TestTenants;
  const ids: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS });
    seedFinanceSettings(t);
    const inv = await issuedInvoice(t, '10.00');
    ids.push(inv.id);
    forceDueDate(ids, 'null');
  }, 60_000);

  afterAll(async () => {
    if (!t) return;
    cleanupFinanceSettings();
    await t.cleanup();
  });

  it('actually nulls due_date on the issued revision', () => {
    const result = sql(`select due_date is null from public.invoice_revisions r join public.invoices i on i.current_revision_id=r.id where i.id='${ids[0]}'`);
    expect(result).toBe('t');
  });
});
