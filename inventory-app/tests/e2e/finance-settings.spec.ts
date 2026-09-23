import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login } from './helpers';

test('Finance Settings route and navigation are absent for Admin', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  const response = await page.goto('/settings/finance');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('link', { name: 'Finance Settings' })).toHaveCount(0);
});

test('Finance Settings route is absent for Manager', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  const response = await page.goto('/settings/finance');
  expect(response?.status()).toBe(404);
});
