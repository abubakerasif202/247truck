import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';
import { sql } from './support/review-fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[listing pagination] skipped: missing ${gap.join(', ')}\n`);
}

type Row = Record<string, unknown>;
type Page = { rows: Row[]; has_more: boolean; next_cursor: string | null; next_cursor_id: string | null };

// Every listing used to be silently truncated at 100 rows, so each dataset
// deliberately exceeds that and is walked with a page size smaller than the
// dataset so several page boundaries are crossed.
const DATASET = 120;
const PAGE = 50;
const BATCH = 20;

async function inBatches<T>(count: number, worker: (index: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < count; start += BATCH) {
    const size = Math.min(BATCH, count - start);
    out.push(...(await Promise.all(Array.from({ length: size }, (_, i) => worker(start + i)))));
  }
  return out;
}

/** Walks a keyset listing to the end and returns every row in order. */
async function walk(call: (cursor: Page | null) => PromiseLike<{ data: unknown; error: unknown }>): Promise<{ rows: Row[]; pages: number }> {
  const rows: Row[] = [];
  let cursor: Page | null = null;
  let pages = 0;
  for (;;) {
    const res = await call(cursor);
    expect(res.error, JSON.stringify(res.error)).toBeNull();
    const page = res.data as Page;
    rows.push(...page.rows);
    pages += 1;
    if (!page.has_more) {
      expect(page.next_cursor).toBeNull();
      expect(page.next_cursor_id).toBeNull();
      break;
    }
    expect(page.rows.length).toBe(PAGE);
    expect(page.next_cursor).not.toBeNull();
    expect(page.next_cursor_id).not.toBeNull();
    cursor = page;
    expect(pages).toBeLessThan(20);
  }
  return { rows, pages };
}

function expectExactCoverage(rows: Row[], expectedIds: Set<string>, idKey = 'id') {
  const seen = rows.map((r) => String(r[idKey]));
  expect(new Set(seen).size, 'duplicate rows across pages').toBe(seen.length);
  const mine = seen.filter((id) => expectedIds.has(id));
  expect(mine.length, 'missing rows across pages').toBe(expectedIds.size);
}

/** Microsecond-precise ordinal for a Postgres jsonb timestamptz (Date.parse only keeps milliseconds). */
function micros(value: unknown): bigint {
  const text = String(value);
  const match = /^(.*?)(?:\.(\d{1,6}))?([Zz]|[+-]\d{2}(?::?\d{2})?)$/.exec(text);
  if (!match) throw new Error(`unparseable timestamp ${text}`);
  const whole = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(whole)) throw new Error(`unparseable timestamp ${text}`);
  return BigInt(whole) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}

function expectDescendingOrder(rows: Row[], tsKey: string, idKey = 'id') {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const prevTs = micros(prev[tsKey]);
    const curTs = micros(cur[tsKey]);
    if (prevTs === curTs) {
      expect(String(prev[idKey]) > String(cur[idKey]), `tie at index ${i} must break on id desc`).toBe(true);
    } else {
      expect(prevTs > curTs, `row ${i} out of order`).toBe(true);
    }
  }
}

/** Gives a block of rows that straddles the first page boundary an identical timestamp. */
function collideTimestamps(table: string, tsCol: string, idCol: string, filter: string) {
  sql(`
    with ranked as (
      select ${idCol} as id, row_number() over (order by ${tsCol} desc, ${idCol} desc) as rn
      from public.${table} where ${filter}
    ), anchor as (
      select ${tsCol} as ts from public.${table} where ${idCol} = (select id from ranked where rn = ${PAGE - 3})
    )
    update public.${table} set ${tsCol} = (select ts from anchor)
    where ${idCol} in (select id from ranked where rn between ${PAGE - 3} and ${PAGE + 3})
  `);
  const distinct = sql(`
    select count(distinct ${tsCol}) from public.${table}
    where ${idCol} in (
      select ${idCol} from public.${table} where ${filter}
      order by ${tsCol} desc, ${idCol} desc offset ${PAGE - 4} limit 7
    )`);
  expect(distinct).toBe('1');
}

suite('listing pagination (quotes, jobs, customers, purchase orders)', () => {
  let t: TestTenants;
  const runTag = randomUUID().slice(0, 8);
  const customerPrefix = `PagFleet ${runTag}`;
  let anchorCustomerId: string;
  let vehicleId: string;
  let productId: string;
  let supplierA: string;
  let supplierB: string;
  const customerIds = new Set<string>();
  const quoteIds = new Set<string>();
  const jobIds = new Set<string>();
  const poIds = new Set<string>();
  const poBySupplier = new Map<string, Set<string>>();

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: [
        'inventory.view', 'quotes.view', 'quotes.create', 'jobs.view', 'jobs.create',
        'purchasing.view', 'purchasing.create_po', 'customers.view',
      ],
    });

    const customers = await inBatches(DATASET, async (i) => {
      const res = await t.admin.rpc('create_customer', {
        p_request_id: randomUUID(),
        p_customer: {
          customer_type: i % 2 === 0 ? 'business' : 'individual',
          display_name: `${customerPrefix} ${String(i).padStart(3, '0')}`,
          company_name: i % 2 === 0 ? `${customerPrefix} ${i} Pty Ltd` : null,
          first_name: i % 2 === 0 ? null : 'Pag',
          last_name: i % 2 === 0 ? null : `Customer${i}`,
          abn: i % 2 === 0 ? '51824753556' : null,
          mobile: `04${String(10_000_000 + i).slice(-8)}`,
          payment_terms: '14_days',
          street_address: `${i} Pagination St`, suburb: 'Lonsdale', state: 'SA', postcode: '5160',
        },
      });
      expect(res.error, JSON.stringify(res.error)).toBeNull();
      return (res.data as { customer_id: string }).customer_id;
    });
    customers.forEach((id) => customerIds.add(id));
    anchorCustomerId = customers[0];

    const vehicle = await t.admin.rpc('add_customer_vehicle', {
      p_customer_id: anchorCustomerId,
      p_vehicle: { vehicle_type: 'truck', registration: `PG${runTag.slice(0, 4).toUpperCase()}` },
    });
    expect(vehicle.error, JSON.stringify(vehicle.error)).toBeNull();
    vehicleId = (vehicle.data as { vehicle_id: string }).vehicle_id;

    const product = await t.admin.rpc('create_product', {
      p_name: `Pagination Test Tyre ${runTag}`, p_category_code: 'truck_tyre', p_selling_price_incl_gst: 500,
      p_tyre_condition: 'new', p_tyre_brand: 'Michelin', p_tyre_size: '295/80R22.5',
    });
    expect(product.error, JSON.stringify(product.error)).toBeNull();
    productId = product.data as string;

    // Jobs reserve stock on creation, so the branch needs enough on hand.
    const stocked = await t.admin.rpc('post_inventory_movement', {
      p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
      p_quantity_delta: DATASET * 2, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100,
    });
    expect(stocked.error, JSON.stringify(stocked.error)).toBeNull();

    const suppliers = await Promise.all(['A', 'B'].map((label) => t.admin.rpc('create_supplier', {
      p_name: `Pagination Supplier ${label} ${runTag}`,
      p_abn: null, p_contact_name: null, p_phone: null, p_email: null,
      p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null,
    })));
    for (const s of suppliers) expect(s.error, JSON.stringify(s.error)).toBeNull();
    supplierA = suppliers[0].data as string;
    supplierB = suppliers[1].data as string;
    poBySupplier.set(supplierA, new Set());
    poBySupplier.set(supplierB, new Set());

    await inBatches(DATASET, async (i) => {
      const quote = await t.lon.rpc('create_quote', {
        p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: anchorCustomerId,
        p_customer_vehicle_id: vehicleId, p_quote: {},
        p_lines: [{ line_type: 'product', product_id: productId, description: `Quote line ${i}`, quantity: 1 }],
      });
      expect(quote.error, JSON.stringify(quote.error)).toBeNull();
      quoteIds.add((quote.data as { quote_id: string }).quote_id);

      const job = await t.lon.rpc('create_job', {
        p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: anchorCustomerId,
        p_customer_vehicle_id: vehicleId, p_job: {},
        p_lines: [{ line_type: 'product', product_id: productId, description: `Job line ${i}`, quantity: 1 }],
      });
      expect(job.error, JSON.stringify(job.error)).toBeNull();
      jobIds.add((job.data as { job_id: string }).job_id);

      const supplierId = i % 2 === 0 ? supplierA : supplierB;
      const po = await t.lon.rpc('create_purchase_order', {
        p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: null,
      });
      expect(po.error, JSON.stringify(po.error)).toBeNull();
      poIds.add(po.data as string);
      poBySupplier.get(supplierId)!.add(po.data as string);
    });

    expect(quoteIds.size).toBe(DATASET);
    expect(jobIds.size).toBe(DATASET);
    expect(poIds.size).toBe(DATASET);

    // now() is fixed inside one transaction, so any multi-row insert produces
    // identical timestamps. Reproduce that around the first page boundary so a
    // timestamp-only cursor would skip rows.
    const idList = (ids: Set<string>) => [...ids].map((id) => `'${id}'`).join(',');
    collideTimestamps('quotes', 'created_at', 'id', `id in (${idList(quoteIds)})`);
    collideTimestamps('jobs', 'opened_at', 'id', `id in (${idList(jobIds)})`);
    collideTimestamps('purchase_orders', 'created_at', 'id', `id in (${idList(poIds)})`);
  }, 180_000);

  afterAll(async () => {
    if (!t) return;
    const idList = (ids: Set<string>) => [...ids].map((id) => `'${id}'`).join(',');
    if (jobIds.size) sql(`delete from public.inventory_reservations where job_id in (${idList(jobIds)}); delete from public.jobs where id in (${idList(jobIds)})`);
    if (quoteIds.size) sql(`delete from public.quotes where id in (${idList(quoteIds)})`);
    if (poIds.size) sql(`delete from public.purchase_orders where id in (${idList(poIds)})`);
    if (customerIds.size) {
      sql(`delete from public.customer_vehicles where customer_id in (${idList(customerIds)}); delete from public.customer_contacts where customer_id in (${idList(customerIds)}); delete from public.customers where id in (${idList(customerIds)})`);
    }
    await t.cleanup();
  });

  it('quotes: every row reachable exactly once across pages, ordered (created_at, id) desc, ties included', async () => {
    const { rows, pages } = await walk((cursor) => t.lon.rpc('quote_summary', {
      p_location_id: t.lonLocationId, p_status: 'draft', p_limit: PAGE,
      p_cursor: cursor?.next_cursor ?? null, p_cursor_id: cursor?.next_cursor_id ?? null,
    }));
    expect(pages).toBeGreaterThanOrEqual(3);
    expectExactCoverage(rows, quoteIds);
    expectDescendingOrder(rows, 'created_at');
    for (const row of rows) expect(row.status).toBe('draft');
  });

  it('quotes: a timestamp-only cursor (legacy callers) still works but is not used by the app', async () => {
    const first = await t.lon.rpc('quote_summary', { p_location_id: t.lonLocationId, p_limit: PAGE });
    expect(first.error).toBeNull();
    const page = first.data as Page;
    const legacy = await t.lon.rpc('quote_summary', { p_location_id: t.lonLocationId, p_limit: PAGE, p_cursor: page.next_cursor });
    expect(legacy.error).toBeNull();
    const firstIds = new Set(page.rows.map((r) => String(r.id)));
    for (const row of (legacy.data as Page).rows) expect(firstIds.has(String(row.id))).toBe(false);
  });

  it('jobs: every row reachable exactly once with status and search filters preserved on every page', async () => {
    const { rows, pages } = await walk((cursor) => t.lon.rpc('job_summary', {
      p_location_id: t.lonLocationId, p_status: 'new', p_query: customerPrefix, p_limit: PAGE,
      p_cursor: cursor?.next_cursor ?? null, p_cursor_id: cursor?.next_cursor_id ?? null,
    }));
    expect(pages).toBeGreaterThanOrEqual(3);
    expectExactCoverage(rows, jobIds);
    expectDescendingOrder(rows, 'opened_at');
    for (const row of rows) {
      expect(row.status).toBe('new');
      expect(String(row.customer_name)).toContain(customerPrefix);
    }

    const none = await t.lon.rpc('job_summary', { p_location_id: t.lonLocationId, p_query: `no-such-job-${runTag}`, p_limit: PAGE });
    expect(none.error).toBeNull();
    expect((none.data as Page).rows.length).toBe(0);
    expect((none.data as Page).has_more).toBe(false);

    const other = await t.lon.rpc('job_summary', { p_location_id: t.lonLocationId, p_status: 'completed', p_query: customerPrefix, p_limit: PAGE });
    expect(other.error).toBeNull();
    expect((other.data as Page).rows.length).toBe(0);
  });

  it('customers: offset pages cover the dataset exactly once with a stable total_count and preserved filter', async () => {
    const seen: Row[] = [];
    let offset = 0;
    let total = -1;
    for (;;) {
      const page = await t.admin.rpc('search_customers', { p_query: customerPrefix, p_filter: 'all', p_limit: PAGE, p_offset: offset });
      expect(page.error, JSON.stringify(page.error)).toBeNull();
      const rows = page.data as Row[];
      if (rows.length === 0) break;
      const pageTotal = Number(rows[0].total_count);
      if (total < 0) total = pageTotal;
      expect(pageTotal).toBe(total);
      seen.push(...rows);
      offset += PAGE;
      expect(offset).toBeLessThan(1000);
    }
    expect(total).toBe(DATASET);
    expectExactCoverage(seen, customerIds);
    const names = seen.map((r) => String(r.display_name));
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);

    const business = await t.admin.rpc('search_customers', { p_query: customerPrefix, p_filter: 'business', p_limit: 100, p_offset: 0 });
    expect(business.error).toBeNull();
    expect((business.data as Row[]).length).toBe(DATASET / 2);
    expect(Number((business.data as Row[])[0].total_count)).toBe(DATASET / 2);
    for (const row of business.data as Row[]) expect(row.customer_type).toBe('business');

    const beyond = await t.admin.rpc('search_customers', { p_query: customerPrefix, p_filter: 'all', p_limit: PAGE, p_offset: 10_000 });
    expect(beyond.error).toBeNull();
    expect((beyond.data as unknown[]).length).toBe(0);

    const badLimit = await t.admin.rpc('search_customers', { p_query: '', p_filter: 'all', p_limit: 101, p_offset: 0 });
    expect(badLimit.error?.message).toBe('INVALID_CUSTOMER_FILTER');
  });

  it('purchase orders: supplier filter is applied inside the query and preserved across every page', async () => {
    for (const supplierId of [supplierA, supplierB]) {
      const { rows, pages } = await walk((cursor) => t.lon.rpc('purchase_order_summary', {
        p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_status: 'draft', p_limit: PAGE,
        p_cursor: cursor?.next_cursor ?? null, p_cursor_id: cursor?.next_cursor_id ?? null,
      }));
      expect(pages).toBeGreaterThanOrEqual(2);
      expectExactCoverage(rows, poBySupplier.get(supplierId)!, 'purchase_order_id');
      expectDescendingOrder(rows, 'created_at', 'purchase_order_id');
      for (const row of rows) {
        expect(row.supplier_id).toBe(supplierId);
        expect(row.status).toBe('draft');
      }
    }

    const all = await walk((cursor) => t.lon.rpc('purchase_order_summary', {
      p_location_id: t.lonLocationId, p_limit: PAGE,
      p_cursor: cursor?.next_cursor ?? null, p_cursor_id: cursor?.next_cursor_id ?? null,
    }));
    expectExactCoverage(all.rows, poIds, 'purchase_order_id');

    const unknownSupplier = await t.lon.rpc('purchase_order_summary', { p_location_id: t.lonLocationId, p_supplier_id: randomUUID(), p_limit: 10 });
    expect(unknownSupplier.error).toBeNull();
    expect((unknownSupplier.data as Page).rows.length).toBe(0);
  });

  it('rejects out-of-range limits and treats a cursor in the past as an empty last page', async () => {
    for (const fn of ['quote_summary', 'job_summary', 'purchase_order_summary']) {
      const bad = await t.lon.rpc(fn, { p_location_id: t.lonLocationId, p_limit: 0 });
      expect(bad.error?.message, fn).toBe('INVALID_LIMIT');
      const tooBig = await t.lon.rpc(fn, { p_location_id: t.lonLocationId, p_limit: 101 });
      expect(tooBig.error?.message, fn).toBe('INVALID_LIMIT');

      const past = await t.lon.rpc(fn, { p_location_id: t.lonLocationId, p_limit: PAGE, p_cursor: '2000-01-01T00:00:00Z', p_cursor_id: randomUUID() });
      expect(past.error, fn).toBeNull();
      expect((past.data as Page).rows.length, fn).toBe(0);
      expect((past.data as Page).has_more, fn).toBe(false);

      // A malformed timestamp is a cast error at the RPC boundary; the app's
      // cursor codec never forwards one (see tests/unit/listing-cursor.test.ts).
      const malformed = await t.lon.rpc(fn, { p_location_id: t.lonLocationId, p_limit: PAGE, p_cursor: 'not-a-timestamp' });
      expect(malformed.error, fn).not.toBeNull();
      expect(malformed.data, fn).toBeNull();
    }
  });

  it('purchase_order_status_counts reflects the whole dataset, not just one page', async () => {
    const counts = await t.lon.rpc('purchase_order_status_counts', { p_location_id: t.lonLocationId });
    expect(counts.error, JSON.stringify(counts.error)).toBeNull();
    const draftCount = Number((counts.data as Record<string, number>).draft ?? 0);
    expect(draftCount).toBeGreaterThanOrEqual(DATASET);
    const truth = Number(sql(`select count(*) from public.purchase_orders where location_id='${t.lonLocationId}' and status='draft'`));
    expect(draftCount).toBe(truth);
  });
});
