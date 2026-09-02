import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestTenants, missingEnv, type TestTenants } from './support/fixtures';

const gap = missingEnv();
const suite = gap.length === 0 ? describe : describe.skip;
if (gap.length > 0) {
  process.stderr.write(`[purchasing security] skipped: missing ${gap.join(', ')}\n`);
}

suite('purchasing supplier security', () => {
  let t: TestTenants;
  let productId: string;
  let supplierId: string;

  beforeAll(async () => {
    t = await createTestTenants({
      lonPermissions: ['inventory.view', 'purchasing.view'],
      regPermissions: ['inventory.view'],
    });

    const product = await t.admin.rpc('create_product', {
      p_name: 'Purchasing security tyre',
      p_category_code: 'truck_tyre',
      p_selling_price_incl_gst: 550,
      p_tyre_condition: 'new',
      p_tyre_brand: 'Security Brand',
      p_tyre_size: '295/80R22.5',
    });
    if (product.error) throw product.error;
    productId = product.data as string;

    const supplier = await t.admin.rpc('create_supplier', {
      p_name: 'Security Supplier',
      p_abn: '12345678901',
      p_contact_name: 'Supplier Admin',
      p_phone: '0400000000',
      p_email: 'security@example.test',
      p_address: '1 Test Street',
      p_payment_terms: '30 days',
      p_account_reference: 'SEC-001',
      p_notes: 'fixture',
    });
    if (supplier.error) throw supplier.error;
    supplierId = supplier.data as string;
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it('lets a Manager with purchasing.view read active supplier metadata', async () => {
    const result = await t.lon
      .from('suppliers')
      .select('id, name, contact_name, phone, email, account_reference, active')
      .eq('id', supplierId)
      .single();

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: supplierId, name: 'Security Supplier', active: true });
  });

  it('blocks Manager direct supplier writes', async () => {
    const insert = await t.lon.from('suppliers').insert({ name: 'Forbidden Supplier' });
    expect(insert.error).not.toBeNull();

    const update = await t.lon
      .from('suppliers')
      .update({ name: 'Forbidden Rename' })
      .eq('id', supplierId);
    expect(update.error).not.toBeNull();

    const remove = await t.lon.from('suppliers').delete().eq('id', supplierId);
    expect(remove.error).not.toBeNull();
  });

  it('blocks Manager execution of Admin supplier mutation RPCs', async () => {
    const create = await t.lon.rpc('create_supplier', {
      p_name: 'Forbidden RPC Supplier',
      p_abn: null,
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_address: null,
      p_payment_terms: null,
      p_account_reference: null,
      p_notes: null,
    });
    expect(create.error?.message).toContain('ACCESS_DENIED');

    const update = await t.lon.rpc('update_supplier', {
      p_supplier_id: supplierId,
      p_name: 'Forbidden RPC Rename',
      p_abn: null,
      p_contact_name: null,
      p_phone: null,
      p_email: null,
      p_address: null,
      p_payment_terms: null,
      p_account_reference: null,
      p_notes: null,
    });
    expect(update.error?.message).toContain('ACCESS_DENIED');

    const archive = await t.lon.rpc('set_supplier_active', {
      p_supplier_id: supplierId,
      p_active: false,
    });
    expect(archive.error?.message).toContain('ACCESS_DENIED');
  });

  it('lets Admin create, update, archive and restore suppliers through RPCs', async () => {
    const update = await t.admin.rpc('update_supplier', {
      p_supplier_id: supplierId,
      p_name: 'Security Supplier Updated',
      p_abn: '12345678901',
      p_contact_name: 'Supplier Admin',
      p_phone: '0400000001',
      p_email: 'updated@example.test',
      p_address: '2 Test Street',
      p_payment_terms: '14 days',
      p_account_reference: 'SEC-002',
      p_notes: 'updated',
    });
    expect(update.error).toBeNull();

    const archive = await t.admin.rpc('set_supplier_active', {
      p_supplier_id: supplierId,
      p_active: false,
    });
    expect(archive.error).toBeNull();

    const archived = await t.service.from('suppliers').select('active').eq('id', supplierId).single();
    expect(archived.data?.active).toBe(false);

    const restore = await t.admin.rpc('set_supplier_active', {
      p_supplier_id: supplierId,
      p_active: true,
    });
    expect(restore.error).toBeNull();
  });

  it('keeps inventory settings branch-scoped while exposing preferred supplier metadata', async () => {
    const { error: associateError } = await t.service.from('product_suppliers').insert({
      product_id: productId,
      supplier_id: supplierId,
      supplier_sku: 'SEC-SKU',
      last_cost: 222.5,
      minimum_order_qty: 1,
    });
    if (associateError) throw associateError;

    const { error: settingsError } = await t.service
      .from('inventory_settings')
      .update({ preferred_supplier_id: supplierId })
      .eq('product_id', productId)
      .eq('location_id', t.lonLocationId);
    if (settingsError) throw settingsError;

    const settings = await t.lon
      .from('inventory_settings')
      .select('product_id, location_id, preferred_supplier_id')
      .eq('product_id', productId);

    expect(settings.error).toBeNull();
    expect(settings.data).toHaveLength(1);
    expect(settings.data?.[0]).toMatchObject({
      product_id: productId,
      location_id: t.lonLocationId,
      preferred_supplier_id: supplierId,
    });
  });

  it('withholds product supplier last cost from authenticated direct reads without inventory.view_cost', async () => {
    const safe = await t.lon
      .from('product_suppliers')
      .select('product_id, supplier_id, supplier_sku, minimum_order_qty')
      .eq('product_id', productId);
    expect(safe.error).toBeNull();

    const cost = await t.lon
      .from('product_suppliers')
      .select('last_cost')
      .eq('product_id', productId);
    expect(cost.error).not.toBeNull();
  });
});
