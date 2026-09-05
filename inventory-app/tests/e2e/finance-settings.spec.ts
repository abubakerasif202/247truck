import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { formStatus, login } from './helpers';

test.describe('Phase 4A finance settings (Admin only)', () => {
  test('Admin can view and save business identity', async ({ page }) => {
    await login(page, E2E_USERS.admin.email);

    await page.goto('/settings/finance');
    await expect(page.getByRole('heading', { name: 'Finance Settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business identity' })).toBeVisible();

    // No provider activation controls exist on this page.
    await expect(page.getByText(/stripe api key/i)).toHaveCount(0);
    await expect(page.getByLabel(/resend/i)).toHaveCount(0);

    await page.getByLabel('Legal / business name').fill('24/7 Truck Tyre Services');
    await page.getByLabel('ABN (11 digits)').fill('12345678901');
    await page
      .locator('form')
      .filter({ has: page.getByLabel('Legal / business name') })
      .getByRole('button', { name: 'Save' })
      .click();

    await expect(formStatus(page)).toContainText(/saved/i);
  });

  test('Manager cannot reach finance settings', async ({ page }) => {
    await login(page, E2E_USERS.lon.email);
    await page.goto('/settings/finance');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
