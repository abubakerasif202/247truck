import { expect, test } from '@playwright/test';
import { E2E_USERS } from './fixtures';
import { login, logout } from './helpers';

async function fillAddress(page: import('@playwright/test').Page) {
  await page.getByLabel('Suburb').fill('Lonsdale');
  await page.getByLabel('State').fill('SA');
  await page.getByLabel('Postcode').fill('5160');
}

test('Admin creates, searches, equips, edits and archives an individual customer', async ({ page }) => {
  // This end-to-end flow crosses several server-rendered routes and can incur
  // cold compilation when it follows the full desktop suite. Keep the budget
  // scoped to this flow; assertions and navigation conditions remain strict.
  test.slow();
  await login(page, E2E_USERS.admin.email);
  await page.goto('/customers/new');
  await page.getByLabel('Full name').fill('E2E Individual Customer');
  await page.getByRole('textbox', { name: 'Mobile', exact: true }).fill('0412 888 111');
  await fillAddress(page);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'E2E Individual Customer' })).toBeVisible();
  await page.goto('/customers?q=0412888111');
  await expect(page.locator('tbody').getByText('E2E Individual Customer').first()).toBeVisible();
  await page.getByRole('link', { name: /CUS-/ }).first().click();
  await page.getByRole('link', { name: 'Add vehicle' }).click();
  await page.getByLabel('Registration').fill('SA E2E 01');
  await page.getByRole('button', { name: 'Add vehicle' }).click();
  await expect(page.getByText('SA E2E 01').first()).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).first().click();
  await page.getByLabel('Full name').fill('E2E Individual Updated');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Individual Updated' })).toBeVisible();
  await page.locator('header').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Archived')).toBeVisible();
});

test('Manager with customer permissions can use the customer route, while an unpermitted manager cannot', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await page.goto('/customers/new');
  await expect(page.getByRole('heading', { name: 'New customer' })).toBeVisible();
  await logout(page);
  await login(page, E2E_USERS.reg.email);
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/dashboard/);
});
