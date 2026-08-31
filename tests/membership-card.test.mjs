import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const card = await readFile(new URL("../app/membership-components.tsx", import.meta.url), "utf8");
const repository = await readFile(new URL("../app/lib/membership-repository.ts", import.meta.url), "utf8");

test("membership card displays the complete public-safe member projection", () => {
  for (const value of ["24/7 Truck Tyre Services", "National Roadside Assistance Member", "membershipNumber", "memberName", "validFrom", "validUntil", "status", "PHONE_DISPLAY"]) assert.match(card, new RegExp(value, "u"));
  assert.doesNotMatch(card, /\.id\b|tokenHash|applicationId/u);
  const fields = repository.match(/const fields = "([^"]+)"/u)?.[1] ?? "";
  assert.doesNotMatch(fields, /(^|,)id(,|$)|token_hash|application_id/u);
});

test("active, expired and cancelled card states have distinct rendering", () => {
  assert.match(card, /status: "active" \| "expired" \| "cancelled"/u);
  assert.match(card, /membership-card--\$\{membership\.status\}/u);
  assert.match(card, /const label = membership\.status\.toUpperCase\(\)/u);
});
