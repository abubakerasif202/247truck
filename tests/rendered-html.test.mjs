import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const components = await readFile(new URL("../app/site-components.tsx", import.meta.url), "utf8");
const developerCredit = await readFile(new URL("../app/ABDeveloperCredit.tsx", import.meta.url), "utf8");
const data = await readFile(new URL("../app/site-data.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8");
const franchise = await readFile(new URL("../app/program-components.tsx", import.meta.url), "utf8");
const enquiryForm = await readFile(new URL("../app/enquiry-form.tsx", import.meta.url), "utf8");
const enquiryApi = await readFile(new URL("../app/api/enquiries/route.ts", import.meta.url), "utf8");
const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("homepage retains the business and conversion contracts", () => {
  const source = `${components}\n${data}\n${layout}`;
  assert.match(source, /24\/7 Truck Tyre Services/);
  assert.match(source, /24\/7 emergency/i);
  assert.match(source, /Complete tyre solutions/i);
  assert.match(source, /Three ways we can help/i);
  assert.match(source, /National Roadside Assistance Program Registration/i);
  assert.match(source, /Franchise opportunities/i);
  assert.match(source, /tel:\+61452636802/);
  assert.match(source, /Regency Park/);
  assert.doesNotMatch(source, /1300 247 879|Customer review placeholder|Editable testimonial|owner portrait/i);
});

test("official imagery, Instagram and map contracts are complete", async () => {
  const source = `${components}\n${data}\n${layout}\n${styles}`;
  const imageFiles = (await readdir(new URL("../public/images/", import.meta.url))).filter((file) => file.endsWith(".webp"));
  assert.deepEqual(imageFiles.sort(), [
    "pack-01-hero-roadside.webp",
    "pack-02-tyre-banner.webp",
    "pack-03-workshop-truck.webp",
    "pack-04-wheel-fitting.webp",
    "pack-05-roadside-technician.webp",
    "pack-06-fleet-yard.webp",
    "pack-07-tyre-warehouse.webp",
    "pack-08-rescue-van.webp",
    "pack-09-workshop-team.webp",
    "pack-10-facility-exterior.webp",
  ]);
  for (const file of imageFiles) assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(source, /https:\/\/www\.instagram\.com\/247trucktyreservice/);
  assert.match(source, /google\.com\/maps\/embed\?pb=!1m18!1m12!1m3!1d3893\.3547912856266/);
  assert.doesNotMatch(source, /illustrative service imagery|hero-truck\.jpg|roadside-truck\.jpg|tyre-closeup\.jpg/i);
});

test("all requested routes remain configured", () => {
  for (const route of ["services", "24-7-truck-tyre-assistance", "truck-tyres", "truck-tyre-fitting", "fleet-tyre-services", "about"]) {
    assert.match(data, new RegExp(`(?:^|\\n)\\s*[\"']?${route.replaceAll("-", "\\-")}[\"']?\\s*:`));
  }
  assert.match(components, /\/gallery/);
  assert.match(components, /\/contact/);
  assert.match(sitemap, /fleet-roadside-assistance/);
  assert.match(sitemap, /franchise/);
  assert.match(sitemap, /privacy/);
});

test("production SEO uses the custom domain without temporary-host leakage", () => {
  const source = `${components}\n${data}\n${layout}\n${sitemap}\n${franchise}`;
  assert.match(source, /https:\/\/www\.247trucktyreservices\.com\.au/);
  assert.doesNotMatch(source, /247truck\.vercel\.app/);
  assert.match(source, /og\.webp/);
});

test("franchise and fleet forms have accessible consent and protected server delivery", () => {
  const source = `${franchise}\n${enquiryForm}\n${enquiryApi}`;
  for (const field of ["firstName", "lastName", "preferredArea", "company", "contactName", "fleetSize", "vehicleTypes", "serviceNeeds", "consent"]) {
    assert.match(source, new RegExp(`name=["']${field}["']|body\\.${field}`));
  }
  assert.match(source, /honeypot/i);
  assert.match(source, /requestOriginIsValid/);
  assert.match(source, /isRateLimited/);
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /ENQUIRY_TO_EMAIL/);
  assert.match(enquiryForm, /fetch\("\/api\/enquiries"/);
  for (const state of ["idle", "submitting", "success", "validationError", "deliveryError"]) {
    assert.match(enquiryForm, new RegExp(`kind: "${state}"`));
  }
  assert.match(enquiryForm, /disabled=\{isSubmitting\}/);
  assert.match(enquiryForm, /form\.reset\(\)/);
  assert.doesNotMatch(enquiryForm, /startedAt:/);
  assert.doesNotMatch(enquiryForm, /temporarily unavailable/i);
  assert.doesNotMatch(enquiryForm, /RESEND_API_KEY|ENQUIRY_TO_EMAIL/);
  assert.match(envExample, /ENQUIRY_TO_EMAIL=admin@247trucktyreservices\.com\.au/);
  assert.match(envExample, /ENQUIRY_FROM_EMAIL=/);
});

test("baseline security headers are configured", () => {
  for (const header of ["Content-Security-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy"]) {
    assert.match(nextConfig, new RegExp(header));
  }
});

test("global AB Digital Solutions credit uses the official secure backlink", () => {
  assert.match(components, /<ABDeveloperCredit \/>/);
  assert.equal((components.match(/<ABDeveloperCredit \/>/g) ?? []).length, 1);
  assert.match(developerCredit, /Designed &amp; Developed by/);
  assert.match(developerCredit, /https:\/\/www\.abwebstudio\.com\.au\//);
  assert.match(developerCredit, /\/branding\/ab-digital-solutions-watermark\.webp/);
  assert.match(developerCredit, /target="_blank"/);
  assert.match(developerCredit, /rel="noopener noreferrer"/);
  assert.match(developerCredit, /aria-label="Visit AB Digital Solutions"/);
});

test("narrow mobile header keeps the menu control in view", () => {
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.header-inner \{ width: calc\(100% - 24px\); gap: 10px; \}/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.brand-logo--compact \{ width: 136px; \}/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.header-social \{ display: none; \}/);
});

test("mobile navigation is a full viewport drawer with an explicit backdrop", () => {
  assert.match(components, /className=\{`menu-backdrop\$\{open \? " is-open" : ""\}`\}/);
  assert.match(components, /const focusable = Array\.from\(navigation\.current\?\.querySelectorAll/);
  assert.match(styles, /\.main-nav \{ position: fixed; z-index: 100; inset: 74px 0 0 auto; width: 100vw; height: calc\(100dvh - 74px\)/);
  assert.match(styles, /\.main-nav\.is-open \{ transform: translate3d\(0, 0, 0\); visibility: visible; pointer-events: auto/);
  assert.match(styles, /\.menu-backdrop\.is-open \{ opacity: 1; visibility: visible; pointer-events: auto/);
});

test("navigation breakpoint and active-page treatment stay aligned", () => {
  assert.match(components, /matchMedia\("\(max-width: 1180px\)"\)/);
  assert.match(components, /aria-current=\{pathname === href \? "page" : undefined\}/);
  assert.match(styles, /@media \(min-width: 901px\) and \(max-width: 1180px\)/);
  assert.match(styles, /\.main-nav a\[aria-current="page"\]::after/);
});
