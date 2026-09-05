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

test('Admin raises a manual service invoice, edits the draft and issues it', async ({ page }) => {
  await login(page, E2E_USERS.admin.email);
  await page.goto('/invoices/new?mode=manual');
  await page.getByLabel('Description').fill('Mobile callout and inspection');
  await page.getByLabel('Unit price (incl GST)').fill('165');
  await page.getByRole('button', { name: 'Create draft invoice' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByText('draft', { exact: false })).toBeVisible();
  await expect(page.getByText('$165.00')).toBeVisible();

  await page.getByRole('link', { name: 'Issue invoice' }).or(page.getByRole('button', { name: 'Issue invoice' })).first().click();
  await expect(page.getByText('issued', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/due /)).toBeVisible();
});

test('Manager invoices a completed job through the job page', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  await createCustomer(page, `E2E Invoice Job ${Date.now()}`);
  await page.goto('/jobs/new');
  await page.getByRole('textbox', { name: 'Search customer' }).fill('E2E Invoice Job');
  await page.getByRole('option').filter({ hasText: 'E2E Invoice Job' }).click();
  await page.getByRole('textbox', { name: 'Search product' }).fill('E2E Sales Product');
  await page.getByRole('option').filter({ hasText: 'E2E Sales Product' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByRole('button', { name: 'Create job' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Complete job', exact: true }).click();
  await expect(page.getByText('Completed — Not invoiced')).toBeVisible();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByText(/LON-INV-\d{6}/)).toBeVisible();
  // job page now links to the invoice
  await page.goBack();
  await expect(page.getByText(/Invoiced:/)).toBeVisible();
});

test('A manager without invoice permissions cannot see or open invoices', async ({ page }) => {
  await login(page, E2E_USERS.reg.email);
  await expect(page.getByRole('link', { name: 'Invoices' })).toHaveCount(0);
  await page.goto('/invoices');
  await expect(page.getByText('Permission denied')).toBeVisible();
});

test('Invoice list is usable at a 320px width with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page, E2E_USERS.admin.email);
  await page.goto('/invoices');
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
