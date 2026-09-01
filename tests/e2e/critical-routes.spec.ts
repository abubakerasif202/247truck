import { expect, test } from "@playwright/test";

const routes = ["/", "/services", "/24-7-truck-tyre-assistance", "/truck-tyres", "/truck-tyre-fitting", "/fleet-tyre-services", "/truck-battery-fitting", "/truck-wash", "/about", "/gallery", "/contact", "/franchise", "/fleet-roadside-assistance", "/book-wheel-alignment", "/privacy"];
const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 768, height: 900 }, { width: 430, height: 800 }, { width: 390, height: 780 }, { width: 360, height: 760 }];

for (const viewport of viewports) {
  test(`critical routes have no horizontal overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      const errors: string[] = [];
      page.removeAllListeners("console");
      page.removeAllListeners("pageerror");
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.ok(), `${route} should load`).toBeTruthy();
      expect(await page.locator("h1").count(), `${route} should have one H1`).toBe(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} overflow`).toBeLessThanOrEqual(1);
      expect(errors, `${route} console errors`).toEqual([]);
    }
  });
}

test("mobile menu is a full drawer and keyboard closable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await toggle.click();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(390);
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
});

test("forms expose labels and booking controls fit narrow mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  for (const route of ["/contact", "/franchise", "/fleet-roadside-assistance", "/book-wheel-alignment"]) {
    await page.goto(route);
    const unlabeled = await page.locator("input:not([type=hidden]), select, textarea").evaluateAll((controls) => controls.filter((control) => !((control as HTMLInputElement).labels?.length || control.getAttribute("aria-label") || control.getAttribute("aria-labelledby"))).length);
    expect(unlabeled, route).toBe(0);
  }
});

test("reduced motion keeps content visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.getByRole("link", { name: /book wheel alignment/i }).first()).toBeVisible();
});

test("battery fitting and truck wash stay call or enquiry only", async ({ page }) => {
  for (const [route, callLabel, alt] of [
    ["/truck-battery-fitting", /call for battery service/i, "Technician fitting a commercial truck battery inside an Adelaide workshop"],
    ["/truck-wash", /call to arrange truck wash/i, "Heavy commercial truck being washed in an industrial Adelaide wash bay"],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("link", { name: callLabel })).toHaveAttribute("href", "tel:+61452636802");
    await expect(page.getByAltText(alt)).toBeVisible();
    await expect(page.getByRole("link", { name: /book now/i })).toHaveCount(0);
    await expect(page.locator('main a[href="/book-wheel-alignment"]')).toHaveCount(0);
  }
});

test("wheel alignment booking completes with the fixed service and pay-at-workshop terms", async ({ page }) => {
  await page.route("**/api/bookings/availability?*", (route) => route.fulfill({ json: { appointments: ["08:00", "10:00", "12:00", "14:00", "16:00"].map((time) => ({ time, label: time === "08:00" ? "8:00 AM" : time, available: time !== "10:00" })) } }));
  await page.route("**/api/bookings", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.service).toBe("truck_wheel_alignment");
    expect(body.startTime).toBe("08:00");
    await route.fulfill({ status: 201, json: { emailDelivered: true, booking: { reference: "247-WA-260901-A7K2", dateLabel: "Tuesday, 1 September 2026", timeLabel: "8:00 AM" } } });
  });
  await page.goto("/book-wheel-alignment");
  await page.getByLabel("Booking date *").fill("2026-09-01");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /8:00 AM Available/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Truck registration *").fill("SA 247");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Customer name *").fill("Ada Driver");
  await page.getByLabel("Mobile number *").fill("0400000000");
  await page.getByLabel("Email *").fill("ada@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Pay at workshop", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("247-WA-260901-A7K2")).toBeVisible();
});

test("membership application stays pending and activated card renders public data", async ({ page }) => {
  await page.route("**/api/memberships/applications", (route) => route.fulfill({ status: 201, json: { ok: true, status: "submitted" } }));
  await page.goto("/fleet-roadside-assistance");
  await page.getByLabel("Full name *").fill("Ada Driver");
  await page.getByLabel("Business / company name *").fill("Fleet Co");
  await page.getByLabel("Email *").fill("ada@example.com");
  await page.getByLabel("Mobile *").fill("0400000000");
  await page.getByLabel("Truck registration *").fill("SA 247");
  await page.getByLabel(/Vehicle type/).fill("Prime mover");
  await page.getByLabel("Operating area *").fill("Adelaide");
  await page.getByLabel("State / territory *").selectOption("SA");
  await page.getByLabel("Postcode *").fill("5000");
  await page.getByLabel("Expected roadside assistance requirements *").fill("Roadside tyre assistance");
  await page.getByLabel(/I confirm these details/).check();
  await page.getByRole("button", { name: "Apply for membership" }).click();
  await expect(page.getByText(/not an active member until activation/i)).toBeVisible();

  const token = "A".repeat(43);
  await page.route("**/api/memberships/card", (route) => route.fulfill({ json: { membership: { membershipNumber: "247-RA-26-A7K92", memberName: "Ada Driver", companyName: "Fleet Co", truckRegistration: "SA 247", validFrom: "2026-09-15", validUntil: "2027-09-15", status: "active" } } }));
  await page.goto(`/membership-card#${token}`);
  await expect(page.getByText("247-RA-26-A7K92")).toBeVisible();
  await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("15 September 2027")).toBeVisible();
});
