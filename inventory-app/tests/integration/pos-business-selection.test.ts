import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const missing = missingEnv();
const run = missing.length === 0 ? describe : describe.skip;
if (missing.length) console.warn(`[pos-business-selection] skipped: missing ${missing.join(', ')}`);

function sql(query: string): string {
  const target = new URL(process.env.SUPABASE_TEST_URL ?? 'http://invalid');
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '55331') throw new Error('LOCAL_SUPABASE_REQUIRED');
  return execFileSync('docker', ['exec', '-i', 'supabase_db_247truck-inventory', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8' }).trim();
}

const PERMS = ['jobs.view', 'jobs.create', 'jobs.edit', 'jobs.complete', 'pos.use', 'inventory.view', 'inventory.stock_in', 'inventory.stock_out', 'invoices.view', 'invoices.create', 'invoices.issue', 'payments.view', 'payments.record'];

run('POS business (brand) selection for shared locations', () => {
  let t: TestTenants;
  let truckOrganizationId: string;
  let awtOrganizationId: string;

  beforeAll(async () => {
    t = await createTestTenants({ lonPermissions: PERMS, regPermissions: PERMS });

    const { data: organizations, error } = await t.service
      .from('organizations').select('id, code').in('code', ['AWT', '247TRUCK']);
    if (error || !organizations || organizations.length !== 2) throw error ?? new Error('organizations missing');
    truckOrganizationId = organizations.find((o) => o.code === '247TRUCK')!.id;
    awtOrganizationId = organizations.find((o) => o.code === 'AWT')!.id;

    // REG is the shared location: both businesses are actively authorized.
    // LON is deliberately left with zero assignments throughout this suite.
    const truckAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: truckOrganizationId, p_location_id: t.regLocationId, p_active: true,
    });
    if (truckAssignment.error) throw truckAssignment.error;
    const awtAssignment = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: true,
    });
    if (awtAssignment.error) throw awtAssignment.error;

  });

  afterAll(async () => {
    if (!t) return;
    await t.cleanup();
  });

  async function productWithStockAtReg(quantity: number) {
    const product = await t.admin.rpc('create_product_with_prices', {
      p_name: `POS brand ${randomUUID()}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 220, p_wholesale_price_incl_gst: 220,
      p_tyre_condition: 'new', p_tyre_brand: 'POS', p_tyre_size: '11R22.5',
    });
    if (product.error) throw product.error;
    const stock = await t.admin.rpc('post_inventory_movement_with_notes', {
      p_request_id: randomUUID(), p_product_id: product.data, p_location_id: t.regLocationId,
      p_quantity_delta: quantity, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100, p_notes: null,
    });
    if (stock.error) throw stock.error;
    return String(product.data);
  }

  function onHandAtReg(productId: string) {
    return Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.regLocationId}'`));
  }

  const newRpcArgs = (requestId: string, productId: string, brand: string | null, extra: Record<string, unknown> = {}) => ({
    p_request_id: requestId, p_location_id: t.regLocationId, p_customer_id: null, p_customer_vehicle_id: null,
    p_job_id: null, p_expected_job_version: null, p_job: { source_type: 'pos', walk_in_label: 'Counter customer' },
    p_lines: [{ line_type: 'product', product_id: productId, description: 'POS tyre', quantity: 1 }],
    p_tenders: [{ method: 'cash', amount: '220.00', reference: null, notes: null }],
    p_brand: brand, ...extra,
  });
  const oldRpcArgs = (requestId: string, productId: string, extra: Record<string, unknown> = {}) => ({
    p_request_id: requestId, p_location_id: t.regLocationId, p_customer_id: null, p_customer_vehicle_id: null,
    p_job_id: null, p_expected_job_version: null, p_job: { source_type: 'pos', walk_in_label: 'Counter customer' },
    p_lines: [{ line_type: 'product', product_id: productId, description: 'POS tyre', quantity: 1 }],
    p_tenders: [{ method: 'cash', amount: '220.00', reference: null, notes: null }],
    ...extra,
  });

  describe('strict POS business options', () => {
    it('REG exposes exactly 247TRUCK + AWT via the strict pos_business_options RPC', async () => {
      const options = await t.reg.rpc('pos_business_options', { p_location_id: t.regLocationId });
      expect(options.error).toBeNull();
      expect(options.data.default_brand).toBeNull();
      expect(options.data.can_override).toBe(true);
      const brands = (options.data.businesses as { brand: string }[]).map((b) => b.brand).sort();
      expect(brands).toEqual(['247', 'awt']);
    });

    it('LON returns zero POS businesses - no legacy location-code fallback for POS authorization', async () => {
      const options = await t.lon.rpc('pos_business_options', { p_location_id: t.lonLocationId });
      expect(options.error).toBeNull();
      expect(options.data.default_brand).toBeNull();
      expect(options.data.can_override).toBe(false);
      expect(options.data.businesses).toEqual([]);
      // Zero ACTIVE assignments is the invariant that matters - the same one
      // transaction_brand_guard/location_authorized_brands enforce. A row can
      // legitimately exist here in a deactivated state (other suites toggle
      // an AWT+LON assignment off in their own afterAll rather than deleting
      // it), so assert on the active flag, not row presence.
      const assignments = await t.service.from('organization_location_assignments').select('organization_id').eq('location_id', t.lonLocationId).eq('active', true);
      expect(assignments.error).toBeNull();
      expect(assignments.data).toHaveLength(0);
    });

    it('the general (legacy-aware) invoice_brand_options is a separate concern and still serves LON its historical default', async () => {
      // This is NOT the POS authorization surface - it is what manual/job
      // invoice creation still legitimately relies on for a location with
      // no organization assignment. Proves the two APIs are genuinely
      // independent, not the same ambiguous one reused for both purposes.
      const options = await t.lon.rpc('invoice_brand_options', { p_location_id: t.lonLocationId });
      expect(options.error).toBeNull();
      expect(options.data.default_brand).toBe('awt');
    });
  });

  describe('finalise_pos_sale_with_brand (strict guard)', () => {
    it('blocks submission at REG with no business selected', async () => {
      const productId = await productWithStockAtReg(3);
      const result = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, null));
      expect(result.error?.message).toContain('BUSINESS_SELECTION_REQUIRED');
      expect(onHandAtReg(productId)).toBe(3);
    });

    it('commits a 247TRUCK sale with the 247TRUCK organization brand and reduces the shared REG balance', async () => {
      const productId = await productWithStockAtReg(5);
      const result = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, '247'));
      expect(result.error, JSON.stringify(result.error)).toBeNull();
      expect(result.data.brand).toBe('247');
      expect(sql(`select brand from public.invoices where id='${result.data.invoice_id}'`)).toBe('247');
      expect(onHandAtReg(productId)).toBe(4);
    });

    it('commits an AWT sale with the AWT organization brand against the same shared REG pool', async () => {
      const productId = await productWithStockAtReg(5);
      const result = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, 'awt'));
      expect(result.error, JSON.stringify(result.error)).toBeNull();
      expect(result.data.brand).toBe('awt');
      expect(sql(`select brand from public.invoices where id='${result.data.invoice_id}'`)).toBe('awt');
      expect(onHandAtReg(productId)).toBe(4);
    });

    it('shows one shared physical balance regardless of which authorized business sells it', async () => {
      const productId = await productWithStockAtReg(10);
      const truckSale = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, '247'));
      expect(truckSale.error).toBeNull();
      const awtSale = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, 'awt'));
      expect(awtSale.error).toBeNull();
      const balanceRows = await t.service.from('inventory_balances').select('on_hand').eq('product_id', productId).eq('location_id', t.regLocationId);
      expect(balanceRows.data).toHaveLength(1);
      expect(balanceRows.data![0]!.on_hand).toBe(8);
    });

    it('rejects an arbitrary/unknown brand string (attack case)', async () => {
      const productId = await productWithStockAtReg(3);
      const denied = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, 'xyz'));
      expect(denied.error?.message).toContain('ACCESS_DENIED');
      expect(onHandAtReg(productId)).toBe(3);
    });

    it('rejects a valid brand at a location with zero authorized organizations (LON, attack case)', async () => {
      const productId = await productWithStockAtReg(3);
      const denied = await t.lon.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, 'awt', { p_location_id: t.lonLocationId }));
      expect(denied.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
      // No movement was created at LON for the rejected attempt: this
      // product has no stock there at all (it only exists at REG).
      expect(Number(sql(`select count(*) from public.inventory_movements where product_id='${productId}' and location_id='${t.lonLocationId}'`))).toBe(0);
    });

    it('rejects a real organization not authorized at this specific location (attack case)', async () => {
      const productId = await productWithStockAtReg(3);
      // 247TRUCK is not assigned to LON.
      const denied = await t.lon.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, '247', { p_location_id: t.lonLocationId }));
      expect(denied.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
    });

    it('rejects an unauthorized actor/location pairing even naming a real authorized organization (attack case)', async () => {
      const productId = await productWithStockAtReg(3);
      // t.lon's manager is only authorized at LON, even though 247TRUCK+REG
      // is a genuine active assignment.
      const denied = await t.lon.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), productId, '247'));
      expect(denied.error?.message).toContain('ACCESS_DENIED');
      expect(onHandAtReg(productId)).toBe(3);
    });

    it('surfaces insufficient stock correctly through the same server-side check finalise_pos_sale already uses', async () => {
      // A shared-catalogue product with no stock movement at REG yet: its
      // zero-seeded balance row means the sale must fail on quantity, not on
      // a missing product/location relationship.
      const product = await t.admin.rpc('create_product_with_prices', {
        p_name: `POS brand no stock ${randomUUID()}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 220, p_wholesale_price_incl_gst: 220,
        p_tyre_condition: 'new', p_tyre_brand: 'POS', p_tyre_size: '11R22.5',
      });
      expect(product.error).toBeNull();
      const result = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(randomUUID(), String(product.data), '247'));
      expect(result.error?.message).toMatch(/INSUFFICIENT_STOCK/);
    });

    it('reuses the same request id on a retry of the same logical sale (idempotent replay)', async () => {
      const productId = await productWithStockAtReg(5);
      const requestId = randomUUID();
      const first = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, '247'));
      expect(first.error).toBeNull();
      const replay = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, '247'));
      expect(replay.error).toBeNull();
      expect(replay.data.invoice_id).toBe(first.data.invoice_id);
      expect(onHandAtReg(productId)).toBe(4);
    });

    it('rejects reusing the same request id with a different business (never silently reattributes)', async () => {
      const productId = await productWithStockAtReg(5);
      const requestId = randomUUID();
      const first = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, '247'));
      expect(first.error).toBeNull();
      const reused = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, 'awt'));
      expect(reused.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
      expect(onHandAtReg(productId)).toBe(4);
    });
  });

  // Narrows REG to exactly one active organization (247TRUCK) for the
  // duration of fn, then always restores AWT's assignment. Gives a genuine
  // single-organization location without depending on LON, which must stay
  // at zero assignments throughout this suite for other tests here.
  async function withSingleOrgReg<T>(fn: () => Promise<T>): Promise<T> {
    const deactivated = await t.admin.rpc('admin_assign_organization_location', {
      p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: false,
    });
    expect(deactivated.error).toBeNull();
    try {
      return await fn();
    } finally {
      const reactivated = await t.admin.rpc('admin_assign_organization_location', {
        p_organization_id: awtOrganizationId, p_location_id: t.regLocationId, p_active: true,
      });
      expect(reactivated.error).toBeNull();
    }
  }

  describe('old finalise_pos_sale hardening (direct-RPC-call bypass)', () => {
    it('fails closed at REG (2 active organizations) with BUSINESS_SELECTION_REQUIRED instead of silently defaulting to 247', async () => {
      const productId = await productWithStockAtReg(3);
      const result = await t.reg.rpc('finalise_pos_sale', oldRpcArgs(randomUUID(), productId));
      expect(result.error?.message).toContain('BUSINESS_SELECTION_REQUIRED');
      // Stock untouched proves the function returned before any write - it
      // never reached job/invoice creation for this rejected attempt.
      expect(onHandAtReg(productId)).toBe(3);
    });

    it('fails closed at LON (0 active organizations) with BUSINESS_NOT_CONFIGURED and creates zero side effects', async () => {
      const productId = await t.admin.rpc('create_product_with_prices', {
        p_name: `POS legacy ${randomUUID()}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 220, p_wholesale_price_incl_gst: 220,
        p_tyre_condition: 'new', p_tyre_brand: 'POS', p_tyre_size: '11R22.5',
      }).then((r) => { if (r.error) throw r.error; return String(r.data); });
      await t.admin.rpc('post_inventory_movement_with_notes', {
        p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
        p_quantity_delta: 5, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100, p_notes: null,
      });
      const requestId = randomUUID();
      const jobsBefore = Number(sql("select count(*) from public.jobs where source_type='pos'"));
      const invoicesBefore = Number(sql('select count(*) from public.invoices'));
      const paymentsBefore = Number(sql('select count(*) from public.payments'));
      const result = await t.lon.rpc('finalise_pos_sale', oldRpcArgs(requestId, productId, { p_location_id: t.lonLocationId }));
      expect(result.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
      expect(Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}'`))).toBe(5);
      expect(Number(sql(`select count(*) from public.inventory_movements where product_id='${productId}' and movement_type<>'quick_stock_in'`))).toBe(0);
      expect(Number(sql("select count(*) from public.jobs where source_type='pos'"))).toBe(jobsBefore);
      expect(Number(sql('select count(*) from public.invoices'))).toBe(invoicesBefore);
      expect(Number(sql('select count(*) from public.payments'))).toBe(paymentsBefore);
      // The denial happens before private.finance_request ever runs: no
      // durable idempotency row was written for this request_id.
      expect(Number(sql(`select count(*) from public.finance_action_requests where request_id='${requestId}'`))).toBe(0);
    });

    it('succeeds at a location with exactly one active organization and derives that organization\'s brand', async () => {
      await withSingleOrgReg(async () => {
        const productId = await productWithStockAtReg(5);
        const result = await t.reg.rpc('finalise_pos_sale', oldRpcArgs(randomUUID(), productId));
        expect(result.error, JSON.stringify(result.error)).toBeNull();
        expect(sql(`select brand from public.invoices where id='${result.data.invoice_id}'`)).toBe('247');
        expect(onHandAtReg(productId)).toBe(4);
        expect(Number(sql(`select count(*) from public.jobs where id='${result.data.job_id}'`))).toBe(1);
        expect(Number(sql(`select count(*) from public.inventory_movements where source_type='job' and source_id='${result.data.job_id}'`))).toBe(1);
      });
    });
  });

  describe('cross-entrypoint idempotency (old vs new RPC, same request_id)', () => {
    it('rejected old RPC at REG (multi-org) leaves the request id unclaimed, so a valid new RPC call may still proceed once', async () => {
      const productId = await productWithStockAtReg(5);
      const requestId = randomUUID();
      const first = await t.reg.rpc('finalise_pos_sale', oldRpcArgs(requestId, productId));
      expect(first.error?.message).toContain('BUSINESS_SELECTION_REQUIRED');
      expect(Number(sql(`select count(*) from public.finance_action_requests where request_id='${requestId}'`))).toBe(0);
      const second = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, '247'));
      expect(second.error).toBeNull();
      expect(onHandAtReg(productId)).toBe(4);
      expect(Number(sql(`select count(*) from public.jobs where id='${second.data.job_id}'`))).toBe(1);
    });

    it('rejected new RPC at LON leaves the request id unclaimed, but the old RPC still fails BUSINESS_NOT_CONFIGURED there too - zero transactions result', async () => {
      const productId = await t.admin.rpc('create_product_with_prices', {
        p_name: `POS cross ${randomUUID()}`, p_category_code: 'truck_tyre', p_retail_price_incl_gst: 220, p_wholesale_price_incl_gst: 220,
        p_tyre_condition: 'new', p_tyre_brand: 'POS', p_tyre_size: '11R22.5',
      }).then((r) => { if (r.error) throw r.error; return String(r.data); });
      await t.admin.rpc('post_inventory_movement_with_notes', {
        p_request_id: randomUUID(), p_product_id: productId, p_location_id: t.lonLocationId,
        p_quantity_delta: 5, p_movement_type: 'quick_stock_in', p_inbound_unit_cost: 100, p_notes: null,
      });
      const requestId = randomUUID();
      const jobsBefore = Number(sql("select count(*) from public.jobs where source_type='pos'"));
      const first = await t.lon.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, 'awt', { p_location_id: t.lonLocationId }));
      expect(first.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
      expect(Number(sql(`select count(*) from public.finance_action_requests where request_id='${requestId}'`))).toBe(0);
      const second = await t.lon.rpc('finalise_pos_sale', oldRpcArgs(requestId, productId, { p_location_id: t.lonLocationId }));
      expect(second.error?.message).toContain('BUSINESS_NOT_CONFIGURED');
      expect(Number(sql(`select on_hand from public.inventory_balances where product_id='${productId}' and location_id='${t.lonLocationId}'`))).toBe(5);
      expect(Number(sql("select count(*) from public.jobs where source_type='pos'"))).toBe(jobsBefore);
    });

    it('genuinely successful old-RPC request cannot be replayed through the new RPC to double-deduct stock', async () => {
      // Needs a location where the OLD brand-less RPC is genuinely eligible
      // to succeed (it now fails closed whenever a location has anything
      // other than exactly one active organization) AND the NEW RPC would
      // ALSO otherwise be authorized to succeed there - otherwise the
      // brand guard, not the idempotency layer, is what's actually being
      // exercised.
      await withSingleOrgReg(async () => {
        const productId = await productWithStockAtReg(5);
        const requestId = randomUUID();
        const first = await t.reg.rpc('finalise_pos_sale', oldRpcArgs(requestId, productId));
        expect(first.error, JSON.stringify(first.error)).toBeNull();
        const onHandAfterFirst = onHandAtReg(productId);
        const replayThroughNew = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, '247'));
        expect(replayThroughNew.error?.message).toContain('IDEMPOTENCY_KEY_REUSED');
        expect(onHandAtReg(productId)).toBe(onHandAfterFirst);
      });
    });

    it('genuinely successful new-RPC request cannot be replayed through the old RPC to double-deduct stock', async () => {
      await withSingleOrgReg(async () => {
        const productId = await productWithStockAtReg(5);
        const requestId = randomUUID();
        const first = await t.reg.rpc('finalise_pos_sale_with_brand', newRpcArgs(requestId, productId, '247'));
        expect(first.error, JSON.stringify(first.error)).toBeNull();
        const onHandAfterFirst = onHandAtReg(productId);
        const replayThroughOld = await t.reg.rpc('finalise_pos_sale', oldRpcArgs(requestId, productId));
        expect(replayThroughOld.error).not.toBeNull();
        expect(onHandAtReg(productId)).toBe(onHandAfterFirst);
      });
    });
  });
});
