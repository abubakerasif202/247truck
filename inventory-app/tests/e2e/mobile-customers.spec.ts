import { expect, test } from '@playwright/test';
import { E2E_USERS } from './fixtures';
import { login } from './helpers';

test('mobile customer list, new customer and add-vehicle route fit the viewport', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
  await page.goto('/customers/new');
  await expect(page.getByRole('heading', { name: 'New customer' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow-x', 'visible');
});
