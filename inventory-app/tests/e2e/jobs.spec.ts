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

test('Manager can create and complete a direct workshop job', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  const customerLabel = `E2E Job ${Date.now()}`;
  await createCustomer(page, customerLabel);
  await page.goto('/jobs/new');
  await page.getByRole('textbox', { name: 'Search customer' }).fill(customerLabel);
  await page.getByRole('option').filter({ hasText: customerLabel }).click();
  await page.getByRole('textbox', { name: 'Search product' }).fill('E2E Sales Product');
  await page.getByRole('option').filter({ hasText: 'E2E Sales Product' }).click();
  await page.getByRole('button', { name: 'Add product' }).click();
  await page.getByRole('button', { name: 'Create job' }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Complete job', exact: true }).click();
  // Job header subtitle reads "<customer> · completed" (distinct from the new
  // "Completed — Not invoiced" finance panel added in Phase 4B).
  await expect(page.getByText(/·\s*completed\s*$/)).toBeVisible();
});
