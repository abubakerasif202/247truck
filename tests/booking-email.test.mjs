import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const email = await readFile(new URL("../app/lib/booking-email.ts", import.meta.url), "utf8");
const validation = await readFile(new URL("../app/lib/booking-validation.ts", import.meta.url), "utf8");

test("customer and workshop confirmation emails contain required booking details", () => {
  assert.match(email, /Truck Wheel Alignment Booking Confirmed/u);
  assert.match(email, /New Truck Wheel Alignment Booking/u);
  assert.match(email, /Payment: Pay at workshop/u);
  assert.match(email, /Secure cancellation link/u);
  assert.match(email, /booking\.companyName/u);
  const customerBody = email.match(/text: `Your Truck Wheel Alignment[\s\S]*?`,\n  \}\);/u)?.[0] ?? "";
  assert.doesNotMatch(customerBody, /cancellationUrl/u);
});

test("booking validation rejects any online-bookable service other than alignment", () => {
  assert.match(validation, /body\.service !== BOOKING_SERVICE/u);
  assert.match(validation, /Only Truck Wheel Alignment can be booked online/u);
});
