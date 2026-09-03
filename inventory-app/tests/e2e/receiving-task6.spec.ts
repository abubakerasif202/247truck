import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { E2E_PASSWORD, E2E_USERS, requireE2EEnv, serviceClient } from './fixtures';
import { login } from './helpers';

let purchaseOrderId: string;
let productName: string;

test.beforeAll(async () => {
  const service = serviceClient();
  const { url } = requireE2EEnv();
  const { data: locations, error: locationsError } = await service
    .from('locations')
    .select('id, code')
    .eq('code', 'LON')
    .single();
  if (locationsError || !locations) throw locationsError ?? new Error('LON location not found');

  const users = await service.auth.admin.listUsers({ perPage: 200 });
  const lon = users.data.users.find((user) => user.email === E2E_USERS.lon.email);
  if (!lon) throw new Error('LON E2E user not found');
  const { error: costPermissionError } = await service
    .from('manager_permissions')
    .delete()
    .eq('user_id', lon.id)
    .eq('permission_key', 'inventory.view_cost');
  if (costPermissionError) throw costPermissionError;
  const { error: permissionsError } = await service.from('manager_permissions').upsert([
    { user_id: lon.id, permission_key: 'purchasing.view', enabled: true },
    { user_id: lon.id, permission_key: 'purchasing.receive_po', enabled: true },
  ], { onConflict: 'user_id,permission_key' });
  if (permissionsError) throw permissionsError;

  const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Missing disposable Supabase anon key.');
  const admin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await admin.auth.signInWithPassword({
    email: E2E_USERS.admin.email,
    password: E2E_PASSWORD,
  });
  if (signInError) throw signInError;

  const suffix = randomUUID().slice(0, 8);
  const supplier = await admin.rpc('create_supplier', {
    p_name: `Task 6 Browser Supplier ${suffix}`,
    p_abn: null,
    p_contact_name: null,
    p_phone: null,
    p_email: null,
    p_address: null,
    p_payment_terms: null,
    p_account_reference: null,
    p_notes: null,
  });
  if (supplier.error) throw supplier.error;

  productName = `Task 6 Browser Tyre ${suffix}`;
  const product = await admin.rpc('create_product', {
    p_name: productName,
    p_category_code: 'truck_tyre',
    p_selling_price_incl_gst: 700,
    p_tyre_condition: 'new',
    p_tyre_brand: 'Task 6 Brand',
    p_tyre_size: '315/80R22.5',
  });
  if (product.error) throw product.error;

  const created = await admin.rpc('create_purchase_order', {
    p_location_id: locations.id,
    p_supplier_id: supplier.data,
    p_notes: 'Task 6 browser verification',
    p_supplier_reference: `BROWSER-${suffix}`,
  });
  if (created.error) throw created.error;
  purchaseOrderId = created.data as string;
  const lines = await admin.rpc('replace_purchase_order_lines', {
    p_purchase_order_id: purchaseOrderId,
    p_lines: [{ product_id: product.data, ordered_quantity: 3, unit_cost: 145, notes: null }],
  });
  if (lines.error) throw lines.error;
  const submitted = await admin.rpc('submit_purchase_order', { p_purchase_order_id: purchaseOrderId });
  if (submitted.error) throw submitted.error;
  const approved = await admin.rpc('approve_purchase_order', { p_purchase_order_id: purchaseOrderId });
  if (approved.error) throw approved.error;
});

test('Admin can partially receive on desktop and sees cost plus success redirect', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await login(page, E2E_USERS.admin.email);
  await page.goto(`/purchasing/purchase-orders/${purchaseOrderId}/receive`);
  await expect(page.getByRole('heading', { name: 'Receive stock' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Unit cost' })).toBeVisible();
  await expect(page.getByText('$145.00').first()).toBeVisible();
  await page.getByLabel(`Receive now for ${productName}`).first().fill('1');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page).toHaveURL(new RegExp(`/purchasing/purchase-orders/${purchaseOrderId}\\?received=1`));
  await expect(page.getByRole('status')).toHaveText('Stock received successfully.');
  expect(consoleErrors).toEqual([]);
});

test.describe('Manager without cost permission on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('sees receiving controls without any cost data', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, E2E_USERS.lon.email);
    await page.goto(`/purchasing/purchase-orders/${purchaseOrderId}/receive`);
    await expect(page.getByRole('heading', { name: 'Receive stock' })).toBeVisible();
    await expect(page.getByLabel(`Receive now for ${productName}`).last()).toBeVisible();
    await expect(page.getByText('Unit cost:', { exact: false })).toHaveCount(0);
    await expect(page.locator('label').filter({ hasText: 'Receive now' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel(`Receive now for ${productName}`).last().fill('2');
    await page.getByRole('button', { name: 'Receive stock' }).click();
    await expect(page).toHaveURL(new RegExp(`/purchasing/purchase-orders/${purchaseOrderId}\\?received=1`));
    await page.goto(`/purchasing/purchase-orders/${purchaseOrderId}/receive`);
    await expect(page.getByText('All purchase order items have already been received.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Receive stock' })).toHaveCount(0);
    const unexpectedErrors = consoleErrors.filter(
      (message) => !message.includes('[inventory] inventory_value_for_scope failed background'),
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
