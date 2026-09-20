import { expect, test } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login } from './helpers';

/**
 * Analytics is real data with no OpenAI dependency, so it's covered fully
 * here. Ask 24/7 itself is only exercised in its disabled state: the local
 * E2E stack never sets OPENAI_AI_ENABLED=true (no CI suite should spend real
 * OpenAI tokens), so this is the actual default-configuration path, not a
 * placeholder. A tool-backed reply is out of scope for automated E2E: it would
 * either spend real OpenAI tokens in CI or require a request-mocking harness
 * this pass does not build. Verifying one is a manual step -- set a real
 * OPENAI_API_KEY and OPENAI_AI_ENABLED=true locally, then ask Ask 24/7 a
 * question and confirm the reply cites tool data.
 */

test('Admin sees the Analytics page with real aggregates and can reach it from the sidebar', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await login(page, E2E_USERS.admin.email);
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page).toHaveURL(/\/analytics/);
  await expect(page.getByRole('heading', { name: 'Analytics & Replenishment' })).toBeVisible();
  await expect(page.getByText('Active products')).toBeVisible();
  await expect(page.getByText('By brand')).toBeVisible();
  await expect(page.getByText('Stock movement')).toBeVisible();

  expect(errors, `Unexpected console errors: ${errors.join('\n')}`).toEqual([]);
});

test('a Manager sees Analytics scoped to their own branch only, with no branch selector', async ({ page }) => {
  await login(page, E2E_USERS.lon.email);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics & Replenishment' })).toBeVisible();
  // Managers never get the Admin-only branch <select>.
  await expect(page.getByLabel('Location')).toHaveCount(0);
});

test('Ask 24/7 shows a clean disabled state and never crashes the app when OpenAI is not configured', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await login(page, E2E_USERS.admin.email);
  await page.getByRole('link', { name: 'Ask 24/7' }).click();
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByText('Ask 24/7 is not configured')).toBeVisible();

  // The rest of the app is unaffected by the assistant being disabled.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  expect(errors, `Unexpected console errors: ${errors.join('\n')}`).toEqual([]);
});

const BREAKPOINTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '400', width: 400, height: 844 },
];

async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

for (const bp of BREAKPOINTS) {
  test.describe(`breakpoint ${bp.name}`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    test(`Analytics has no horizontal overflow at ${bp.name}px`, async ({ page }) => {
      await login(page, E2E_USERS.admin.email);
      await page.goto('/analytics');
      await expect(page.getByRole('heading', { name: 'Analytics & Replenishment' })).toBeVisible();
      expect(await hasHorizontalOverflow(page), `overflow at ${bp.name}px`).toBe(false);
    });

    test(`Ask 24/7 disabled state has no horizontal overflow at ${bp.name}px`, async ({ page }) => {
      await login(page, E2E_USERS.admin.email);
      await page.goto('/assistant');
      await expect(page.getByText('Ask 24/7 is not configured')).toBeVisible();
      expect(await hasHorizontalOverflow(page), `overflow at ${bp.name}px`).toBe(false);
    });
  });
}
