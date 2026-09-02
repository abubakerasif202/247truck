import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login } from './helpers';

test('Admin sees All/LON/REG scope options and the Users page', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);

  const scope = page.getByRole('combobox');
  await expect(scope).toBeVisible();
  await expect(scope.getByRole('option')).toHaveText([
    'All Locations',
    'Lonsdale',
    'Regency Park',
  ]);

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('Invite a Manager')).toBeVisible();
});

test('Admin can edit reorder thresholds per branch', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  await page.goto('/inventory');
  await page.getByRole('link', { name: 'E2E New Line-Haul 315/80R22.5' }).click();

  await expect(page.getByRole('heading', { name: 'Reorder thresholds' })).toBeVisible();
  const lonForm = page.locator('form', { hasText: 'Lonsdale' });
  await lonForm.getByLabel('Minimum').fill('6');
  await lonForm.getByLabel('Reorder qty').fill('12');
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
