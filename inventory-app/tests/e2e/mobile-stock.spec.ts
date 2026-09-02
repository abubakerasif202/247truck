import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { formStatus, login } from './helpers';

test('mobile shell: bottom nav visible, sidebar hidden, no QR/barcode', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);

  await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Primary', exact: true }),
  ).toBeHidden();

  await expect(page.getByText(/barcode/i)).toHaveCount(0);
  await expect(page.getByText(/scan/i)).toHaveCount(0);
});

test('mobile Stock-In form fits the viewport and completes', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  await page.getByRole('link', { name: 'Stock In' }).click();
  await expect(page).toHaveURL(/\/stock\/in/);

  // No horizontal overflow.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);

  await page.getByLabel('Search products').fill('E2E Used Casing');
  await page.getByRole('button', { name: /E2E Used Casing/ }).first().click();
  await page.getByLabel('Quantity').fill('3');
  await page.getByLabel('Unit cost (GST incl.)').fill('120');
  await page.getByRole('button', { name: 'Add stock' }).click();
  await expect(formStatus(page)).toContainText('On hand is now');
});
