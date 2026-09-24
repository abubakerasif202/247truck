import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login } from './helpers';

test('Admin sees All/LON/REG scope options and the Users page', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);

  const scope = page.getByRole('combobox');
  await expect(scope).toBeVisible();
  await expect(scope.getByRole('option')).toHaveText([
    'All Locations',
    '24/7 Truck Tyre Services',
    'Adelaide Wholesale Tyres',
  ]);

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('Invite a Manager')).toBeVisible();
});

test('Admin can edit reorder thresholds per branch', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  await page.getByRole('combobox').selectOption('LON');
  await page.waitForTimeout(300);
  await page.goto('/inventory?location=LON');
  await page.getByLabel('Search products').fill('E2E New Line-Haul 315/80R22.5');
  await page.getByRole('button', { name: 'Apply' }).click();
  await Promise.all([
    page.waitForURL(/\/inventory\/[0-9a-f-]{36}$/),
    page.getByRole('link', { name: 'E2E New Line-Haul 315/80R22.5' }).first().click(),
  ]);

  await expect(page.getByRole('heading', { name: 'Reorder thresholds' })).toBeVisible();
  const lonForm = page.locator('form', { hasText: 'Adelaide Wholesale Tyres' });
  await lonForm.getByLabel('Minimum').fill('6');
  await lonForm.getByLabel('Reorder qty').fill('12');
  await lonForm.getByRole('button', { name: 'Save' }).click();
  await expect(lonForm.locator('[role="status"]')).toHaveText('Saved');

  // This is a shared, name-keyed fixture product (global.setup.ts reuses it
  // across specs/runs) that is never given stock, so a nonzero minimum
  // leaves it permanently "below threshold" for the rest of this run --
  // other specs (e.g. purchasing.spec.ts's "no products need reordering"
  // check) assert against the full reorder list, not just their own
  // fixtures. Restore a non-eligible threshold once the save itself is
  // proven, rather than leaking reorder-eligibility state cross-file.
  await lonForm.getByLabel('Minimum').fill('0');
  await lonForm.getByLabel('Reorder qty').fill('1');
  await lonForm.getByRole('button', { name: 'Save' }).click();
  await expect(lonForm.locator('[role="status"]')).toHaveText('Saved');
});

test('REG Manager never sees WAC or inventory value', async ({ page }) => {
  await login(page, E2E_USERS.reg.email);
  await page.goto('/dashboard');
  const valueTile = page
    .locator('div', { has: page.getByText('Inventory value') })
    .last();
  await expect(valueTile).toContainText('—');

  await page.goto('/inventory');
  await expect(page.getByRole('columnheader', { name: 'WAC' })).toHaveCount(0);
});

test('Admin creates minimal zero-stock products in each active workspace', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  for (const [scope, name] of [['LON', 'E2E AWT Minimal Product'], ['REG', 'E2E 247 Minimal Product']] as const) {
    await page.getByLabel(/Location scope/).selectOption(scope);
    await page.waitForTimeout(300);
    await page.goto('/inventory/new');
    await page.getByLabel(/Product name/).fill(name);
    await page.getByLabel(/Retail price/).fill('100');
    await page.getByRole('button', { name: 'Create product' }).click();
    await expect(page).toHaveURL(/\/inventory\/[0-9a-f-]{36}\?created=1$/);
    await expect(page.getByRole('status')).toHaveText('Product created successfully.');
    await expect(page.getByText('$100.00')).toBeVisible();
    await expect(page.getByText('0 available')).toBeVisible();
  }
});
