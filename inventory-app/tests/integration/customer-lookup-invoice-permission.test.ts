import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[customer-lookup-invoice-permission] skipped: missing ${missing.join(', ')}`);

/**
 * app/api/sales/{customers,vehicles}/route.ts and search_customers were all
 * widened to let a user with invoices.view + invoices.create (but none of
 * customers.view/quotes.view/jobs.view/pos.use) look up customers for the
 * manual invoice form. get_customer was missed: it still required
 * customers.view alone, so /api/sales/vehicles (which calls get_customer)
 * kept raising ACCESS_DENIED for exactly the user the other three call sites
 * were just unblocked for -- an unhandled 500 the moment that user selected
 * a customer, despite being able to search for one in the same form.
 */
run('get_customer invoice-permission parity with search_customers', () => {
  let t: TestTenants;
  let customerId: string;
  const createdCustomers: string[] = [];

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['invoices.view', 'invoices.create'],
    });
    const customer = await t.admin.rpc('create_customer', {
      p_request_id: randomUUID(),
      p_customer: { customer_type: 'individual', display_name: 'Invoice Lookup Customer', mobile: '0400000123', suburb: 'Lonsdale', state: 'SA', postcode: '5160' },
    });
    expect(customer.error).toBeNull();
    customerId = customer.data.customer_id;
    createdCustomers.push(customerId);
  });

  afterAll(async () => {
    if (t) {
      await t.service.from('customers').delete().in('id', createdCustomers);
      await t.cleanup();
    }
  });

  it('lets an invoice-only user load a customer (and its vehicles) exactly as it can already search for one', async () => {
    const searched = await t.lon.rpc('search_customers', { p_query: 'Invoice Lookup', p_filter: 'all', p_limit: 20 });
    expect(searched.error).toBeNull();
    expect(searched.data.some((row: { id: string }) => row.id === customerId)).toBe(true);

    const detail = await t.lon.rpc('get_customer', { p_customer_id: customerId });
    expect(detail.error).toBeNull();
    expect(detail.data.id).toBe(customerId);
    expect(detail.data.vehicles).toEqual([]);
  });

  it('still denies a user with neither customers.view nor invoice permissions', async () => {
    const bare = await createTestTenants({});
    try {
      const denied = await bare.lon.rpc('get_customer', { p_customer_id: customerId });
      expect(denied.error?.message).toContain('ACCESS_DENIED');
    } finally {
      await bare.cleanup();
    }
  });
});
