import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { E2E_PASSWORD, E2E_USERS, requireE2EEnv, serviceClient } from './fixtures';
import { login, logout } from './helpers';

test('Managers and Admin complete an audited branch transfer on desktop and mobile-safe UI', async ({ page }) => {
  test.setTimeout(120_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  const service = serviceClient();
  const { url } = requireE2EEnv();
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('Missing disposable Supabase anon key.');
  const locations = await service.from('locations').select('id,code').in('code', ['LON', 'REG']);
  const lonId = locations.data?.find(location => location.code === 'LON')?.id;
  const regId = locations.data?.find(location => location.code === 'REG')?.id;
  if (!lonId || !regId) throw new Error('Transfer locations missing.');

  const admin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await admin.auth.signInWithPassword({ email: E2E_USERS.admin.email, password: E2E_PASSWORD });
  if (signIn.error) throw signIn.error;
  const productName = `E2E Transfer Tyre ${randomUUID().slice(0, 8)}`;
  const product = await admin.rpc('create_product', {
    p_name: productName, p_category_code: 'truck_tyre', p_selling_price_incl_gst: null,
    p_tyre_condition: 'new', p_tyre_brand: 'E2E Transfer', p_tyre_size: '295/80R22.5',
  });
  if (product.error) throw product.error;
  const stocked = await admin.rpc('post_inventory_movement', {
    p_request_id: randomUUID(), p_product_id: product.data, p_location_id: lonId,
    p_quantity_delta: 4, p_movement_type: 'quick_stock_in', p_reason: null,
    p_inbound_unit_cost: 88, p_used_tyre_unit_id: null, p_source_type: 'e2e',
    p_source_id: randomUUID(), p_supplier_name: null,
  });
  if (stocked.error) throw stocked.error;
  await admin.auth.signOut();

  await login(page, E2E_USERS.lon.email);
  await page.goto('/transfers/new');
  await page.getByLabel('Source branch').selectOption(lonId);
  await page.getByLabel('Destination branch').selectOption(regId);
  await page.getByLabel('Product 1').selectOption({ label: productName });
  await page.getByLabel('Quantity 1').fill('2');
  await page.getByRole('button', { name: 'Submit transfer request' }).click();
  await expect(page).toHaveURL(/\/transfers\/[0-9a-f-]+$/);
  const transferUrl = page.url();
  await expect(page.getByText('Requested', { exact: true })).toBeVisible();
  await logout(page);

  await login(page, E2E_USERS.admin.email);
  await page.goto(transferUrl);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await logout(page);

  await login(page, E2E_USERS.lon.email);
  await page.goto(transferUrl);
  await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
  await expect(page.getByText('In Transit', { exact: true })).toBeVisible();
  await logout(page);

  await login(page, E2E_USERS.reg.email);
  await page.goto(transferUrl);
  await page.getByRole('link', { name: 'Receive stock' }).click();
  await page.getByLabel(productName).fill('2');
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page).toHaveURL(transferUrl);
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();

  const balances = await service.from('inventory_balances').select('location_id,on_hand').eq('product_id', product.data);
  expect(balances.data?.find(balance => balance.location_id === lonId)?.on_hand).toBe(2);
  expect(balances.data?.find(balance => balance.location_id === regId)?.on_hand).toBe(2);
  expect(runtimeErrors).toEqual([]);
});
