import { expect, test } from "@playwright/test";

for (const width of [320, 375, 768, 1180, 1280, 1440]) {
  test(`homepage actions fit and navigate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const booking = page.locator('[data-home-booking]:visible');
    await expect(booking).toHaveCount(1);
    const rect = await booking.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await booking.focus();
    await expect(booking).toBeFocused();
    if (width <= 1180) {
      const call = page.locator('.mobile-actions a[href^="tel:"]');
      await expect(call).toBeVisible();
      const callRect = await call.boundingBox();
      expect(callRect!.x + callRect!.width).toBeLessThanOrEqual(rect!.x);
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.locator('[data-home-booking]:visible')).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await booking.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book-wheel-alignment$/);
    await expect(page.getByLabel("Booking date *")).toBeVisible();
    await expect(page.locator('[data-home-booking]')).toHaveCount(0);
  });
}

for (const width of [375, 1440]) {
  test(`consent UI takes priority and booking returns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator('[data-home-booking]:visible')).toHaveCount(1);
    await page.evaluate(() => {
      const banner = document.createElement("div");
      banner.id = "cookie-banner";
      banner.style.cssText = "position:fixed;bottom:0;left:0;width:100%;height:180px;background:white;z-index:999";
      banner.textContent = "Consent choices";
      document.body.append(banner);
    });
    await expect(page.locator('[data-home-booking]:visible')).toHaveCount(0);
    await page.locator("#cookie-banner").evaluate((element) => element.remove());
    await expect(page.locator('[data-home-booking]:visible')).toHaveCount(1);
  });
}

test("desktop yields to forms and reduced motion stops the accent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.locator('[data-home-booking]:visible');
  expect(await card.locator('span[aria-hidden="true"]').evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.locator("form").first().scrollIntoViewIfNeeded();
  await expect(page.locator('[data-home-booking]:visible')).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('[data-home-booking]:visible')).toHaveCount(1);
});

test("automotive enquiry remains prominent and leads to contact", async ({ page }) => {
  for (const path of ["/", "/automotive-repairs"]) {
    await page.goto(path);
    const enquiry = page.getByRole("link", { name: "Need Car Servicing or Repairs? Contact Us" });
    await expect(enquiry).toHaveAttribute("href", "/contact");
    await enquiry.click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator("form")).toBeVisible();
  }
});
