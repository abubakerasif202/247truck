import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { formAlert, formStatus, login } from './helpers';

test.describe('LON Manager stock flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, E2E_USERS.lon.email);
  });

  async function pickProduct(page: import('@playwright/test').Page, name: string) {
    await page.getByLabel('Search products').fill(name);
    await page.getByRole('button', { name: new RegExp(name) }).first().click();
  }

  test('Quick Stock-In twice then verify on-hand and WAC', async ({ page }) => {
    await page.goto('/stock/in');
    await pickProduct(page, 'E2E New Line-Haul');

    await page.getByLabel('Quantity').fill('10');
    await page.getByLabel('Unit cost (GST incl.)').fill('400');
    await page.getByRole('button', { name: 'Add stock' }).click();
    await expect(formStatus(page)).toContainText('On hand is now 10');

    await page.getByLabel('Quantity').fill('10');
    await page.getByLabel('Unit cost (GST incl.)').fill('500');
    await page.getByRole('button', { name: 'Add stock' }).click();
    await expect(formStatus(page)).toContainText('On hand is now 20');
  });

  test('Stock-Out is blocked above available and succeeds within it', async ({ page }) => {
    await page.goto('/stock/out');
    await pickProduct(page, 'E2E New Line-Haul');

    await page.getByLabel('Quantity').fill('9999');
    await expect(formAlert(page)).toContainText('available');
    await expect(page.getByRole('button', { name: 'Remove stock' })).toBeDisabled();

    await page.getByLabel('Quantity').fill('2');
    await page.getByLabel('Reason').selectOption('damaged');
    await page.getByRole('button', { name: 'Remove stock' }).click();
    await expect(formStatus(page)).toContainText('On hand is now');
  });

  test('Adjustment with a reason updates the count', async ({ page }) => {
    await page.goto('/stock/adjust');
    await pickProduct(page, 'E2E New Line-Haul');

    await page.getByLabel('Reason (required)').fill('Physical count correction');
    await page.getByLabel('Counted quantity').fill('17');
    await page.getByRole('button', { name: 'Save count' }).click();
    await expect(formStatus(page)).toContainText('On hand is now 17');
  });

  test('Individual used-tyre intake creates a unit code', async ({ page }) => {
    await page.goto('/stock/used-intake');
    await pickProduct(page, 'E2E Used Casing');

    await page.getByLabel('Tread depth (mm)').fill('9.5');
    await page.getByLabel('Condition').selectOption('good');
    await page.getByLabel('Cost basis (GST incl.)').fill('140');
    await page.getByRole('button', { name: 'Add unit' }).click();
    await expect(formStatus(page)).toContainText(/Unit UT-\d{6} added/);
  });
});
