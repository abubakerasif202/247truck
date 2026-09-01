import assert from "node:assert/strict";
import { test } from "node:test";
import { addOneCalendarYear, derivePublicAccessToken, generateMembershipNumber, generatePublicAccessToken, hashPublicAccessToken, membershipStatus } from "../app/lib/membership-domain.ts";
import { validateMembershipApplication } from "../app/lib/membership-validation.ts";

test("membership numbers are public-safe and non-sequential", () => {
  const values = new Set(Array.from({ length: 100 }, () => generateMembershipNumber(new Date("2026-09-15T00:00:00Z"))));
  assert.equal(values.size, 100);
  for (const value of values) assert.match(value, /^247-RA-26-[23456789A-HJ-NP-Z]{5}$/u);
});

test("public access tokens are strong and stored only as hashes", () => {
  const token = generatePublicAccessToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(hashPublicAccessToken(token), /^[0-9a-f]{64}$/u);
  assert.notEqual(hashPublicAccessToken(token), token);
});

test("activation retries derive the same strong token for one application", () => {
  const secret = "verification-secret-that-is-at-least-32-characters";
  const applicationId = "123e4567-e89b-42d3-a456-426614174000";
  const token = derivePublicAccessToken(applicationId, secret);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(derivePublicAccessToken(applicationId, secret), token);
  assert.notEqual(derivePublicAccessToken("123e4567-e89b-42d3-a456-426614174001", secret), token);
  assert.notEqual(derivePublicAccessToken(applicationId, `${secret}-rotated`), token);
  assert.throws(() => derivePublicAccessToken(applicationId, "too-short"), /at least 32/u);
});

test("one calendar year handles leap-day boundaries", () => {
  assert.equal(addOneCalendarYear("2026-09-15"), "2027-09-15");
  assert.equal(addOneCalendarYear("2024-02-29"), "2025-02-28");
});

test("expiry is inclusive for the Adelaide business date", () => {
  assert.equal(membershipStatus("active", "2027-09-15", new Date("2027-09-15T14:29:00Z")), "active");
  assert.equal(membershipStatus("active", "2027-09-15", new Date("2027-09-15T14:31:00Z")), "expired");
  assert.equal(membershipStatus("cancelled", "2028-01-01"), "cancelled");
});

test("registration validation normalizes fields and requires consent", () => {
  const valid = validateMembershipApplication({ fullName: "  Ada  Driver ", companyName: "Fleet Co", email: "ADA@EXAMPLE.COM", phone: "0400 000 000", truckRegistration: " sa 123 ", vehicleType: "Prime mover", operatingArea: "Adelaide", state: "SA", postcode: "5000", serviceNeeds: "Roadside tyre assistance", submissionId: "123e4567-e89b-42d3-a456-426614174000", consent: true });
  assert.ok("data" in valid);
  if ("data" in valid) { assert.equal(valid.data.fullName, "Ada Driver"); assert.equal(valid.data.email, "ada@example.com"); assert.equal(valid.data.truckRegistration, "SA 123"); }
  assert.deepEqual(validateMembershipApplication({}), { error: "Please enter your full name.", field: "fullName" });
});
