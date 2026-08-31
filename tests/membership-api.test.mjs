import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import { sendMembershipApplicationEmail } from "../app/lib/membership-email.ts";
import { validateMembershipApplication } from "../app/lib/membership-validation.ts";

const originalFetch = globalThis.fetch;
const envNames = ["RESEND_API_KEY", "MEMBERSHIP_ADMIN_EMAIL", "MEMBERSHIP_FROM_EMAIL", "ENQUIRY_TO_EMAIL", "ENQUIRY_FROM_EMAIL"];
const originalEnvironment = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

function validData() {
  const result = validateMembershipApplication({ fullName: "Ada Driver", companyName: "Fleet Co", email: "ada@example.com", phone: "0400 000 000", truckRegistration: "SA 123", vehicleType: "Prime mover", fleetSize: "1-5", operatingArea: "Adelaide", state: "SA", postcode: "5000", serviceNeeds: "Roadside tyre assistance", submissionId: "123e4567-e89b-42d3-a456-426614174000", consent: true });
  assert.ok("data" in result);
  return result.data;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "resend-secret";
  process.env.MEMBERSHIP_ADMIN_EMAIL = "admin@example.com";
  process.env.MEMBERSHIP_FROM_EMAIL = "24/7 Truck Tyre Services <memberships@example.com>";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("membership application notification contains application data and no invented payment", async () => {
  let request;
  globalThis.fetch = async (url, init) => { request = { url: String(url), init }; return Response.json({ id: "email-1" }); };
  await sendMembershipApplicationEmail(validData());
  const email = JSON.parse(request.init.body);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.deepEqual(email.to, ["admin@example.com"]);
  assert.equal(email.reply_to, "ada@example.com");
  assert.match(email.subject, /membership application/i);
  assert.match(email.text, /not yet activated/i);
  assert.doesNotMatch(email.text, /payment|price|fee/iu);
});

test("membership application notification fails closed when delivery is unconfigured", async () => {
  delete process.env.RESEND_API_KEY;
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  await assert.rejects(() => sendMembershipApplicationEmail(validData()), /not configured/i);
  assert.equal(called, false);
});

test("public lookup projection excludes internal IDs and token hashes", async () => {
  const source = await readFile(new URL("../app/lib/membership-repository.ts", import.meta.url), "utf8");
  const fields = source.match(/const fields = "([^"]+)"/u)?.[1] ?? "";
  assert.match(fields, /membership_number/);
  assert.doesNotMatch(fields, /(^|,)id(,|$)|token_hash|application_id/u);
});

test("activation is server-authorised, atomic, retryable, and emails a fragment card link", async () => {
  const route = await readFile(new URL("../app/api/memberships/activate/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/202608310002_roadside_memberships.sql", import.meta.url), "utf8");
  const activationEmail = await readFile(new URL("../app/lib/membership-activation-email.ts", import.meta.url), "utf8");
  assert.match(route, /MEMBERSHIP_ACTIVATION_SECRET/u);
  assert.match(route, /timingSafeEqual/u);
  assert.match(migration, /function public\.activate_roadside_membership/u);
  assert.match(migration, /application\.status = 'approved'[\s\S]*public_access_token_hash = p_token_hash/u);
  assert.match(activationEmail, /\/membership-card#\$\{membership\.token\}/u);
});
