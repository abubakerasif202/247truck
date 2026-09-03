import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { E2E_PASSWORD, E2E_USERS, requireE2EEnv, serviceClient } from './fixtures';
import { login } from './helpers';

let productName: string;
let productId: string;

test.beforeAll(async () => {
  const service = serviceClient();
  const { url } = requireE2EEnv();
  const location = await service.from('locations').select('id').eq('code', 'LON').single();
  if (location.error) throw location.error;

  const users = await service.auth.admin.listUsers({ perPage: 200 });
  const lon = users.data.users.find((user) => user.email === E2E_USERS.lon.email);
  if (!lon) throw new Error('LON E2E user not found');
  const permissions = await service.from('manager_permissions').upsert([
    { user_id: lon.id, permission_key: 'purchasing.view', enabled: true },
    { user_id: lon.id, permission_key: 'purchasing.create_po', enabled: true },
  ], { onConflict: 'user_id,permission_key' });
  if (permissions.error) throw permissions.error;

  const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Missing disposable Supabase anon key.');
  const admin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await admin.auth.signInWithPassword({ email: E2E_USERS.admin.email, password: E2E_PASSWORD });
  if (signedIn.error) throw signedIn.error;

  const suffix = randomUUID().slice(0, 8);
  const supplier = await admin.rpc('create_supplier', {
    p_name: `Task 7 Browser Supplier ${suffix}`,
    p_abn: null, p_contact_name: null, p_phone: null, p_email: null,
    p_address: null, p_payment_terms: null, p_account_reference: null, p_notes: null,
  });
  if (supplier.error) throw supplier.error;
  const product = await admin.rpc('create_product', {
    p_name: `Task 7 Browser Product ${suffix}`,
    p_category_code: 'other_part', p_selling_price_incl_gst: 100,
  });
  if (product.error) throw product.error;
  productId = product.data as string;
  productName = `Task 7 Browser Product ${suffix}`;

  const association = await service.from('product_suppliers').insert({
    product_id: productId, supplier_id: supplier.data, last_cost: 20, minimum_order_qty: 1,
  });
  if (association.error) throw association.error;
  const settings = await admin.rpc('set_inventory_reorder_settings', {
    p_product_id: productId, p_location_id: location.data.id,
    p_minimum_stock: 5, p_reorder_quantity: 7, p_preferred_supplier_id: supplier.data,
  });
  if (settings.error) throw settings.error;
});

test('Admin can select a low-stock product and create a draft PO on desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, E2E_USERS.admin.email);
  await page.goto('/purchasing/reorder?location=LON');
  await expect(page.getByRole('heading', { name: 'Smart reorder' })).toBeVisible();
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Suggestions only')).toBeVisible();
  await page.getByRole('checkbox', { name: `Select ${productName}` }).first().check();
  await page.getByRole('button', { name: 'Create draft POs' }).click();
  await expect(page.getByRole('status')).toContainText('1 draft purchase orders created.');
  await expect(page.getByRole('link', { name: 'View draft purchase order' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('Manager reorder page', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is location locked and usable on mobile', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, E2E_USERS.lon.email);
    await page.goto('/purchasing/reorder');
    await expect(page.getByRole('heading', { name: 'Smart reorder', exact: true })).toBeVisible();
    await expect(page.getByText('Lonsdale (LON)')).toBeVisible();
    await expect(page.getByLabel('View branch')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: productName, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create draft POs' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const unexpected = errors.filter((message) => !message.includes('[inventory] inventory_value_for_scope failed background'));
    expect(unexpected).toEqual([]);
  });
});
