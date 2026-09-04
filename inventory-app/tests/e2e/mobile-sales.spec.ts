import { expect, test } from '@playwright/test';
import { E2E_USERS } from './fixtures';
import { login } from './helpers';

test('Workshop POS remains usable without horizontal overflow on mobile', async ({ page }) => {
  await login(page, E2E_USERS.lon.email); await page.goto('/pos'); await expect(page.getByRole('heading', { name: 'Workshop POS' })).toBeVisible(); const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth })); expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
});

