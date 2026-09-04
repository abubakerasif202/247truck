import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login, logout } from './helpers';

test.setTimeout(120_000);

const productName = 'Ralson RMR61 295/80r22.5';

test('Admin makes the fixed opening stock live and branch permissions stay isolated', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await login(page, E2E_USERS.admin.email);
  await page.goto('/inventory/import');

  await expect(page.getByRole('heading', { name: 'Opening Stock Import' })).toBeVisible();
  await expect(page.getByText('53 product lines', { exact: true })).toBeVisible();
  await expect(page.getByText('725 tyres', { exact: true })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: /^Regency Park$/ })).toBeVisible();
  await expect(page.getByText('New', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Cost pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Selling price pending', { exact: true })).toBeVisible();

  const makeLive = page.getByRole('button', { name: 'Make 725 tyres live' });
  await expect(makeLive).toBeEnabled();
  await makeLive.click();
  await expect(page.getByText('Opening stock import complete', { exact: true })).toBeVisible({ timeout: 90_000 });

  await page.goto(`/inventory?q=${encodeURIComponent(productName)}`);
  const adminRow = page.getByRole('row', { name: new RegExp('Ralson RMR61 295/80r22\\.5', 'i') });
  await expect(adminRow).toBeVisible();
  await expect(adminRow.getByText('0', { exact: true })).toBeVisible();
  await expect(adminRow.getByText('51', { exact: true })).toBeVisible();
  await expect(adminRow.getByText('Price Pending', { exact: true })).toBeVisible();

  await adminRow.getByRole('link', { name: productName }).click();
  await expect(page.getByText('Selling price pending', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Opening cost pending', { exact: true }).first()).toBeVisible();

  await logout(page);
  await login(page, E2E_USERS.reg.email);
  await page.goto(`/inventory?q=${encodeURIComponent(productName)}`);
  const regRow = page.getByRole('row', { name: new RegExp('Ralson RMR61 295/80r22\\.5', 'i') });
  await expect(regRow).toBeVisible();
  await expect(regRow.getByText('51', { exact: true })).toBeVisible();
  await expect(regRow.getByText('Price Pending', { exact: true })).toBeVisible();
  await expect(regRow.getByText('Cost Pending', { exact: true })).toHaveCount(0);

  await logout(page);
  await login(page, E2E_USERS.lon.email);
  await page.goto(`/inventory?q=${encodeURIComponent(productName)}`);
  const lonRow = page.getByRole('row', { name: new RegExp('Ralson RMR61 295/80r22\\.5', 'i') });
  await expect(lonRow).toBeVisible();
  await expect(lonRow.getByText('0', { exact: true })).toBeVisible();
  await expect(lonRow.getByText('51', { exact: true })).toHaveCount(0);
  await expect(page.getByText('REG 51', { exact: true })).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
