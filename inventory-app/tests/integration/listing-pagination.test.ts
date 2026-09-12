import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[listing pagination] skipped: missing ${gap.join(', ')}\n`);
}

type Page = { rows: Array<Record<string, unknown>>; has_more: boolean; next_cursor: unknown };

suite('listing pagination (quotes, jobs, customers, purchase orders)', () => {
  let t: TestTenants;
  let customerId: string;
  let vehicleId: string;
  let productId: string;
  let supplierId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: [
        'inventory.view', 'quotes.view', 'quotes.create', 'jobs.view', 'jobs.create',
        'purchasing.view', 'purchasing.create_po',
      ],
    });

    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: {
        customer_type: 'business', display_name: 'Pagination Fleet', company_name: 'Pagination Fleet',
        abn: '51824753556', mobile: '0400000077', payment_terms: '14_days',
        street_address: '77 Pagination St', suburb: 'Lonsdale', state: 'SA', postcode: '5160',
      },
    });
    expect(customer.error).toBeNull();
    customerId = (customer.data as { customer_id: string }).customer_id;

    const vehicle = await t.admin.rpc('add_customer_vehicle', {
      p_customer_id: customerId,
      p_vehicle: { vehicle_type: 'truck', registration: `PAG${randomUUID().slice(0, 4).toUpperCase()}` },
    });
    expect(vehicle.error).toBeNull();
    vehicleId = (vehicle.data as { vehicle_id: string }).vehicle_id;

    const product = await t.admin.rpc('create_product', {
      p_name: 'Pagination Test Tyre', p_category_code: 'truck_tyre', p_selling_price_incl_gst: 500,
      p_tyre_condition: 'new', p_tyre_brand: 'Michelin', p_tyre_size: '295/80R22.5',
    });
    expect(product.error).toBeNull();
    productId = product.data as string;

    const supplier = await t.admin.rpc('create_supplier', {
      p_name: `Pagination Supplier ${randomUUID().slice(0, 8)}`,
      p_abn: null, p_contact_name: null, p_phone: null, p_email: null,
      p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null,
    });
    expect(supplier.error).toBeNull();
    supplierId = supplier.data as string;

    // Three quotes and three jobs, created sequentially so created_at ordering is deterministic.
    for (let i = 0; i < 3; i += 1) {
      const quote = await t.lon.rpc('create_quote', {
        p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId,
        p_customer_vehicle_id: vehicleId, p_quote: {},
        p_lines: [{ line_type: 'product', product_id: productId, description: `Line ${i}`, quantity: 1 }],
      });
      expect(quote.error).toBeNull();

      const job = await t.lon.rpc('create_job', {
        p_request_id: randomUUID(), p_location_id: t.lonLocationId, p_customer_id: customerId,
        p_customer_vehicle_id: vehicleId, p_job: {},
        p_lines: [{ line_type: 'product', product_id: productId, description: `Line ${i}`, quantity: 1 }],
      });
      expect(job.error).toBeNull();

      const po = await t.lon.rpc('create_purchase_order', {
        p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_notes: null, p_supplier_reference: null,
      });
      expect(po.error).toBeNull();
    }
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('paginates quotes with a keyset cursor and no overlap or gaps', async () => {
    const first = await t.lon.rpc('quote_summary', { p_location_id: t.lonLocationId, p_limit: 2 });
    expect(first.error).toBeNull();
    const firstPage = first.data as Page;
    expect(firstPage.rows.length).toBe(2);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_cursor).not.toBeNull();

    const second = await t.lon.rpc('quote_summary', {
      p_location_id: t.lonLocationId, p_cursor: firstPage.next_cursor, p_limit: 2,
    });
    expect(second.error).toBeNull();
    const secondPage = second.data as Page;
    expect(secondPage.rows.length).toBeGreaterThanOrEqual(1);
    expect(secondPage.has_more).toBe(false);

    const firstIds = new Set(firstPage.rows.map((r) => r.id));
    for (const row of secondPage.rows) expect(firstIds.has(row.id)).toBe(false);
  });

  it('paginates jobs with a keyset cursor', async () => {
    const first = await t.lon.rpc('job_summary', { p_location_id: t.lonLocationId, p_limit: 2 });
    expect(first.error).toBeNull();
    const firstPage = first.data as Page;
    expect(firstPage.rows.length).toBe(2);
    expect(firstPage.has_more).toBe(true);

    const second = await t.lon.rpc('job_summary', {
      p_location_id: t.lonLocationId, p_cursor: firstPage.next_cursor, p_limit: 2,
    });
    const secondPage = second.data as Page;
    const firstIds = new Set(firstPage.rows.map((r) => r.id));
    for (const row of secondPage.rows) expect(firstIds.has(row.id)).toBe(false);
  });

  it('reports an accurate total_count for search_customers regardless of page size', async () => {
    const page1 = await t.admin.rpc('search_customers', { p_query: 'Pagination Fleet', p_filter: 'all', p_limit: 1, p_offset: 0 });
    expect(page1.error).toBeNull();
    const rows1 = page1.data as Array<{ total_count: number }>;
    expect(rows1.length).toBe(1);
    expect(Number(rows1[0].total_count)).toBeGreaterThanOrEqual(1);

    const beyond = await t.admin.rpc('search_customers', { p_query: 'Pagination Fleet', p_filter: 'all', p_limit: 50, p_offset: 10_000 });
    expect(beyond.error).toBeNull();
    expect((beyond.data as unknown[]).length).toBe(0);
  });

  it('filters purchase orders by supplier inside the query, not after fetch, and paginates', async () => {
    const filtered = await t.lon.rpc('purchase_order_summary', {
      p_location_id: t.lonLocationId, p_supplier_id: supplierId, p_limit: 2,
    });
    expect(filtered.error).toBeNull();
    const page = filtered.data as Page;
    expect(page.rows.length).toBe(2);
    for (const row of page.rows) expect(row.supplier_id).toBe(supplierId);
    expect(page.has_more).toBe(true);

    const otherSupplier = await t.lon.rpc('purchase_order_summary', {
      p_location_id: t.lonLocationId, p_supplier_id: randomUUID(), p_limit: 10,
    });
    expect(otherSupplier.error).toBeNull();
    expect((otherSupplier.data as Page).rows.length).toBe(0);
  });

  it('purchase_order_status_counts reflects the whole dataset, not just one page', async () => {
    const counts = await t.lon.rpc('purchase_order_status_counts', { p_location_id: t.lonLocationId });
    expect(counts.error).toBeNull();
    const draftCount = Number((counts.data as Record<string, number>).draft ?? 0);
    expect(draftCount).toBeGreaterThanOrEqual(3);
  });
});
