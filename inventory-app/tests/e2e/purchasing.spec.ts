import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { E2E_PASSWORD, E2E_USERS, requireE2EEnv, serviceClient } from './fixtures';
import { login, logout } from './helpers';

test.setTimeout(120_000);

test('Admin and LON Manager complete the purchasing workflow without crossing branches', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const service = serviceClient();
  const { url } = requireE2EEnv();
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Missing disposable Supabase anon key.');

  const suffix = randomUUID().slice(0, 8);
  const supplierName = `Task 9 Browser Supplier ${suffix}`;
  const productName = `Task 9 Browser Product ${suffix}`;
  const location = await service.from('locations').select('id').eq('code', 'LON').single();
  if (location.error || !location.data) throw location.error ?? new Error('LON location not found');

  const users = await service.auth.admin.listUsers({ perPage: 200 });
  const lon = users.data.users.find((user) => user.email === E2E_USERS.lon.email);
  if (!lon) throw new Error('LON E2E user not found');
  const permissions = await service.from('manager_permissions').upsert([
    { user_id: lon.id, permission_key: 'purchasing.view', enabled: true },
    { user_id: lon.id, permission_key: 'purchasing.create_po', enabled: true },
    { user_id: lon.id, permission_key: 'purchasing.submit_po', enabled: true },
    { user_id: lon.id, permission_key: 'purchasing.receive_po', enabled: true },
  ], { onConflict: 'user_id,permission_key' });
  if (permissions.error) throw permissions.error;

  await login(page, E2E_USERS.admin.email);
  await page.goto('/purchasing/suppliers');
  await page.getByText('Add supplier', { exact: true }).click();
  // Scope every assertion to the "new supplier" form. The page renders one
  // inline edit form per existing supplier row, each with an identical
  // "Supplier name" label and its own role="status" node, so unscoped
  // locators are ambiguous whenever suppliers already exist (e.g. left over
  // by an earlier integration run in the same CI job).
  const createSupplierForm = page.locator('form', {
    has: page.locator('#supplier-name-new'),
  });
  await createSupplierForm.locator('#supplier-name-new').fill(supplierName);
  await createSupplierForm.getByRole('button', { name: 'Create supplier' }).click();
  await expect(createSupplierForm.getByRole('status')).toHaveText('Supplier saved.');
  await expect(page.getByText(supplierName, { exact: true }).first()).toBeVisible();

  const supplier = await service.from('suppliers').select('id').eq('name', supplierName).single();
  if (supplier.error || !supplier.data) throw supplier.error ?? new Error('Created supplier not found');
  const admin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await admin.auth.signInWithPassword({
    email: E2E_USERS.admin.email,
    password: E2E_PASSWORD,
  });
  if (signedIn.error) throw signedIn.error;
  const product = await admin.rpc('create_product', {
    p_name: productName,
    p_category_code: 'other_part',
    p_selling_price_incl_gst: 100,
  });
  if (product.error || !product.data) throw product.error ?? new Error('Product creation failed');
  const association = await service.from('product_suppliers').insert({
    product_id: product.data,
    supplier_id: supplier.data.id,
    last_cost: 100,
    minimum_order_qty: 1,
  });
  if (association.error) throw association.error;
  const settings = await admin.rpc('set_inventory_reorder_settings', {
    p_product_id: product.data,
    p_location_id: location.data.id,
    p_minimum_stock: 5,
    p_reorder_quantity: 5,
    p_preferred_supplier_id: supplier.data.id,
  });
  if (settings.error) throw settings.error;
  await admin.auth.signOut();

  await page.context().clearCookies();
  await login(page, E2E_USERS.admin.email);
  await page.goto('/purchasing/reorder?location=LON');
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
  await logout(page);

  await login(page, E2E_USERS.lon.email);
  await page.goto('/purchasing/purchase-orders/new');
  const locationSelect = page.getByLabel('Location');
  await expect(locationSelect).toBeDisabled();
  await expect(locationSelect.locator('option')).toHaveCount(1);
  await expect(locationSelect.locator('option')).toHaveText('LON — Lonsdale');
  await page.getByLabel('Supplier', { exact: true }).selectOption({ label: supplierName });
  await page.getByLabel('Product 1').selectOption({ label: productName });
  await page.getByLabel('Quantity 1').fill('5');
  await page.getByLabel('Unit cost 1').fill('100');
  await page.getByRole('button', { name: 'Create draft' }).click();
  const openPurchaseOrder = page.getByRole('link', { name: 'Open purchase order' });
  await expect(openPurchaseOrder).toBeVisible();
  const poPath = await openPurchaseOrder.getAttribute('href');
  if (!poPath) throw new Error('Draft purchase order link missing');
  await openPurchaseOrder.click();
  await expect(page.locator('main').getByText(/·\s*LON\b/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
  await logout(page);

  await login(page, E2E_USERS.admin.email);
  await page.goto(poPath);
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await logout(page);

  await login(page, E2E_USERS.lon.email);
  await page.goto(poPath);
  await page.getByRole('link', { name: 'Receive stock' }).click();
  const receiptLine = page.getByRole('row', { name: new RegExp(productName) });
  await receiptLine.getByRole('spinbutton', { name: `Receive now for ${productName}` }).fill('2');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page).toHaveURL(new RegExp(`${poPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?received=1`));
  await expect(page.getByText('Partially Received', { exact: true }).first()).toBeVisible();

  const partialPo = await service.from('purchase_orders').select('status').eq('id', poPath.split('/').pop()!).single();
  const partialLine = await service.from('purchase_order_lines').select('received_quantity').eq('purchase_order_id', poPath.split('/').pop()!).single();
  const partialBalance = await service.from('inventory_balances').select('on_hand, weighted_average_cost').eq('product_id', product.data).eq('location_id', location.data.id).single();
  expect(partialPo.data?.status).toBe('partially_received');
  expect(partialLine.data?.received_quantity).toBe(2);
  expect(partialBalance.data).toMatchObject({ on_hand: 2, weighted_average_cost: 100 });

  await page.getByRole('link', { name: 'Receive stock' }).click();
  await receiptLine.getByRole('spinbutton', { name: `Receive now for ${productName}` }).fill('3');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
  const finalPo = await service.from('purchase_orders').select('status').eq('id', poPath.split('/').pop()!).single();
  const finalLine = await service.from('purchase_order_lines').select('ordered_quantity, received_quantity').eq('purchase_order_id', poPath.split('/').pop()!).single();
  const finalBalance = await service.from('inventory_balances').select('on_hand, weighted_average_cost').eq('product_id', product.data).eq('location_id', location.data.id).single();
  expect(finalPo.data?.status).toBe('received');
  expect(finalLine.data).toMatchObject({ ordered_quantity: 5, received_quantity: 5 });
  expect(finalBalance.data).toMatchObject({ on_hand: 5, weighted_average_cost: 100 });

  await page.goto('/purchasing/reorder?location=REG');
  await expect(page.getByText('Lonsdale (LON)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('View branch')).toHaveCount(0);
  await expect(page.getByText(productName, { exact: true })).toHaveCount(0);
  await expect(page.getByText('No products are currently below their configured reorder threshold.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors.filter((message) => !message.includes('[inventory] inventory_value_for_scope failed background'))).toEqual([]);
});
