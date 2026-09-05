import { expect, test } from '@playwright/test';
import { E2E_USERS } from './fixtures';
import { login } from './helpers';

async function createCustomer(page: import('@playwright/test').Page, label: string) {
  await page.goto('/customers/new');
  await page.getByLabel('Full name').fill(label);
  await page.getByRole('textbox', { name: 'Mobile', exact: true }).fill(`0412 ${Date.now().toString().slice(-6)}`);
  await page.getByLabel('Suburb').fill('Lonsdale');
  await page.getByLabel('State').fill('SA');
  await page.getByLabel('Postcode').fill('5160');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
}

test('Admin completes quote to accepted job workflow', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  const customer = `E2E Quote ${Date.now()}`;
  await createCustomer(page, customer);
  await page.goto('/quotes/new');
  await page.getByRole('textbox', { name: 'Search customer' }).fill(customer);
  await page.getByRole('option').filter({ hasText: customer }).click();
  await page.getByRole('textbox', { name: 'Search product' }).fill('E2E Sales Product');
  await page.getByRole('option').filter({ hasText: 'E2E Sales Product' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByLabel('Labour description').fill('Fit and balance');
  await page.getByLabel('Labour price').fill('55');
  await page.getByRole('button', { name: 'Add labour' }).click();
  await page.getByRole('button', { name: 'Save quote draft' }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Send quote' }).click();
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByRole('button', { name: 'Convert to job' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
});
