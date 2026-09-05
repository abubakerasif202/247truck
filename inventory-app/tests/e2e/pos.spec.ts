import { expect, test } from '@playwright/test';
import { E2E_USERS } from './fixtures';
import { login } from './helpers';

test('Workshop POS supports Walk-In product and labour entry', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  await page.goto('/pos');
  await expect(page.getByRole('button', { name: 'Walk-in customer' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search product' }).fill('E2E Sales Product');
  await page.getByRole('option').filter({ hasText: 'E2E Sales Product' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByLabel('Labour description').fill('Roadside fitting');
  await page.getByLabel('Labour price').fill('80');
  await page.getByRole('button', { name: 'Add labour' }).click();
  await page.getByRole('button', { name: 'Start workshop job' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
  await expect(page.getByText('Walk-in', { exact: false })).toBeVisible();
});
