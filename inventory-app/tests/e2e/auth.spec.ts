import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { formAlert, login } from './helpers';

test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('wrong password shows the exact friendly error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(E2E_USERS.admin.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(formAlert(page)).toHaveText('Email or password is incorrect.');
});

test('Admin can sign in and sees the location scope selector', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  const scope = page.getByRole('combobox');
  await expect(scope).toBeVisible();
  await expect(scope.locator('option')).toHaveText([
    'All Locations',
    '24/7 Truck Tyre Services',
    'Adelaide Wholesale Tyres',
  ]);
});

test('LON Manager is pinned to Adelaide Wholesale Tyres with no scope selector or Users page', async ({
  page,
}) => {
  await login(page, E2E_USERS.lon.email);

  await expect(page.getByRole('banner').getByText('Adelaide Wholesale Tyres', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);

  await page.goto('/settings/users');
  await expect(page).toHaveURL(/\/dashboard/);
});

test('REG Manager only ever sees the 24/7 branch in inventory', async ({ page }) => {
  await login(page, E2E_USERS.reg.email);
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await expect(page.getByText('Adelaide Wholesale Tyres')).toHaveCount(0);
});
