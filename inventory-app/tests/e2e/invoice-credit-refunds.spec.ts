import { expect, test, type Page } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login } from './helpers';

async function createIssuedInvoice(page: Page, amount = '100'): Promise<string> {
  await page.goto('/invoices/new?mode=manual');
  await page.getByLabel('Description').fill(`Phase 4D browser invoice ${Date.now()}`);
  await page.getByLabel('Price basis').selectOption('inclusive');
  await page.getByLabel('Unit price', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Create draft invoice' }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
  const invoiceUrl = page.url();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText('issued', { exact: true }).first()).toBeVisible();
  return invoiceUrl;
}

async function recordPayment(page: Page, amount: string): Promise<void> {
  await page.getByLabel('Payment amount').fill(amount);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Succeeded', { exact: true })).toBeVisible();
}

async function issueCredit(page: Page, amount: string, cash = '0'): Promise<void> {
  await page.getByLabel('Credit amount incl GST').fill(amount);
  await page.getByLabel('Cash return (optional)').fill(cash);
  await page.getByLabel('Reason', { exact: true }).fill('Phase 4D browser correction');
  await page.getByRole('button', { name: cash === '0' ? 'Issue credit note' : 'Issue credit + refund' }).click();
}

test.describe('Phase 4D credit and refund UI', () => {
  test('issues a debt-only credit and updates outstanding without refund due', async ({ page }) => {
    await login(page, E2E_USERS.admin.email);
    await createIssuedInvoice(page);
    await issueCredit(page, '20');
    await expect(page.getByText('Credit history')).toBeVisible();
    await expect(page.getByText('Outstanding: $80.00')).toBeVisible();
    await expect(page.getByText('Refund due: $0.00')).toBeVisible();
  });

  test('creates a pending cash-return refund and confirms the manual payout', async ({ page }) => {
    await login(page, E2E_USERS.admin.email);
    await createIssuedInvoice(page);
    await recordPayment(page, '60');
    await issueCredit(page, '20', '10');
    await expect(page.getByText('Refund payout history')).toBeVisible();
    await expect(page.getByText('$10.00 · pending')).toBeVisible();
    await expect(page.getByText('Refund due: $10.00')).toBeVisible();
    await page.getByPlaceholder('Payout reference').fill('E2E-4D-PAYOUT-1');
    await page.getByPlaceholder('Evidence of actual payout').fill('Signed cash payout receipt E2E-4D-PAYOUT-1');
    await page.getByRole('button', { name: 'Confirm payout occurred' }).click();
    await expect(page.getByText('$10.00 · succeeded')).toBeVisible();
    await expect(page.getByText('Refund due: $0.00')).toBeVisible();
    await expect(page.getByText('Credit history')).toBeVisible();
  });

  test('rejects an excessive refund without committing credit or payout rows', async ({ page }) => {
    await login(page, E2E_USERS.admin.email);
    await createIssuedInvoice(page);
    await recordPayment(page, '40');
    await issueCredit(page, '20', '50');
    await expect(page.locator('p[role="alert"]')).toContainText(/refund|payment|exceed|credit/i);
    await expect(page.getByText('Credit history')).toHaveCount(0);
    await expect(page.getByText('Refund payout history')).toHaveCount(0);
  });

  test('keeps a paid cancellation issued while pending, then finalises it after payout', async ({ page }) => {
    await login(page, E2E_USERS.admin.email);
    await createIssuedInvoice(page);
    await recordPayment(page, '40');
    await page.getByRole('button', { name: 'Request cancellation' }).click();
    await page.getByLabel('Reason for cancelling').fill('Phase 4D customer cancellation');
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.getByText('issued', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Refund due: $40.00')).toBeVisible();
    await expect(page.getByText('$40.00 · pending')).toBeVisible();
    await page.getByPlaceholder('Payout reference').fill('E2E-4D-CANCEL-PAYOUT');
    await page.getByPlaceholder('Evidence of actual payout').fill('Signed cancellation payout receipt');
    await page.getByRole('button', { name: 'Confirm payout occurred' }).click();
    await expect(page.getByText('Refund due: $0.00')).toBeVisible();
    if (await page.getByLabel('Reason for cancelling').count() === 0) {
      await page.getByRole('button', { name: 'Request cancellation' }).click();
    }
    await page.getByLabel('Reason for cancelling').fill('Phase 4D cancellation finalisation');
    await page.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(page.getByText('Cancelled: Phase 4D cancellation finalisation')).toBeVisible();
    await expect(page.getByText('Credit history')).toBeVisible();
    await expect(page.getByText('Refund payout history')).toBeVisible();
  });

  test('hides credit/refund mutation controls from a manager without refunds.create', async ({ page }) => {
    await login(page, E2E_USERS.admin.email);
    const invoiceUrl = await createIssuedInvoice(page);
    await page.goto('/login');
    await login(page, E2E_USERS.lon.email);
    await page.goto(invoiceUrl);
    await expect(page.getByText('Credit / refund')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Issue credit note' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Issue credit + refund' })).toHaveCount(0);
  });

  test('keeps the credit/refund section usable on a Pixel 7 viewport', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await login(page, E2E_USERS.admin.email);
    await createIssuedInvoice(page);
    await expect(page.getByText('Credit / refund')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Issue credit note' })).toBeVisible();
  });
});
