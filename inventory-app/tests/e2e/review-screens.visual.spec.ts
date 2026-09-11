import { test, expect } from '@playwright/test';

import { E2E_USERS } from './fixtures';
import { login } from './helpers';

const OUT = process.env.REVIEW_SHOTS_DIR ?? 'test-results/review-shots';
const SCREENS = ['/inventory', '/inventory?page=2', '/invoices', '/invoices?status=overdue', '/receivables', '/stock/in'];

for (const [label, width] of [['desktop', 1280], ['mobile', 400]] as const) {
  test(`review screens render without horizontal overflow (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, E2E_USERS.admin.email);
    for (const path of SCREENS) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows at ${label}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${OUT}/${label}${path.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: true });
    }
  });
}
