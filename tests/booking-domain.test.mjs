import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  BOOKING_START_TIMES,
  adelaideDateTime,
  addCalendarDays,
  validateBookingDateTime,
} from "../app/lib/booking-time.ts";
import {
  createBookingReference,
  createCancellationToken,
  hashCancellationToken,
} from "../app/lib/booking-security.ts";

const mondayMorningAdelaide = new Date("2026-09-13T22:00:00.000Z"); // Monday 07:30 ACST

test("official appointment schedule contains only five two-hour starts", () => {
  assert.deepEqual(BOOKING_START_TIMES, ["08:00", "10:00", "12:00", "14:00", "16:00"]);
  for (const time of ["08:00", "10:00", "12:00", "14:00", "16:00"]) {
    assert.equal(validateBookingDateTime("2026-09-14", time, mondayMorningAdelaide).ok, true);
  }
  for (const time of ["09:00", "11:00", "13:00", "15:00"]) {
    const result = validateBookingDateTime("2026-09-14", time, mondayMorningAdelaide);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "startTime");
  }
});

test("Monday and Saturday are accepted and Sunday is rejected", () => {
  assert.equal(validateBookingDateTime("2026-09-14", "08:00", mondayMorningAdelaide).ok, true);
  assert.equal(validateBookingDateTime("2026-09-19", "08:00", mondayMorningAdelaide).ok, true);
  const sunday = validateBookingDateTime("2026-09-20", "08:00", mondayMorningAdelaide);
  assert.equal(sunday.ok, false);
  if (!sunday.ok) assert.match(sunday.message, /Sunday/i);
});

test("past slots and dates beyond the Adelaide-local 30-day window are rejected", () => {
  const afterTenAdelaide = new Date("2026-09-14T01:00:00.000Z"); // Monday 10:30 ACST
  assert.equal(validateBookingDateTime("2026-09-14", "10:00", afterTenAdelaide).ok, false);
  assert.equal(validateBookingDateTime("2026-09-14", "12:00", afterTenAdelaide).ok, true);
  assert.equal(validateBookingDateTime(addCalendarDays("2026-09-14", 30), "08:00", afterTenAdelaide).ok, true);
  assert.equal(validateBookingDateTime(addCalendarDays("2026-09-14", 31), "08:00", afterTenAdelaide).ok, false);
});

test("Adelaide date conversion is independent of server and browser timezone", () => {
  assert.deepEqual(adelaideDateTime(new Date("2026-10-03T15:45:00.000Z")), {
    date: "2026-10-04",
    time: "01:15",
  });
  assert.deepEqual(adelaideDateTime(new Date("2026-10-04T16:45:00.000Z")), {
    date: "2026-10-05",
    time: "03:15",
  });
});

test("references and cancellation tokens are public-safe and non-sequential", () => {
  const first = createBookingReference("2026-09-15");
  const second = createBookingReference("2026-09-15");
  assert.match(first, /^247-WA-260915-[A-HJ-NP-Z2-9]{4}$/u);
  assert.notEqual(first, second);
  const token = createCancellationToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(hashCancellationToken(token), /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(hashCancellationToken(token), new RegExp(token, "u"));
});

test("migration enforces official slots, active uniqueness, cancellation release, and private REST access", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260831085536_create_wheel_alignment_bookings.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /start_time in \(time '08:00'.*time '16:00'\)/su);
  assert.match(migration, /unique index wheel_alignment_one_active_booking_per_slot[\s\S]*where status = 'confirmed'/u);
  assert.match(migration, /status in \('confirmed', 'cancelled'\)/u);
  assert.match(migration, /revoke all .* from anon, authenticated/u);
  assert.match(migration, /enable row level security/u);
});

test("availability implementation returns slot state only, never booking customer fields", async () => {
  const route = await readFile(new URL("../app/api/bookings/availability/route.ts", import.meta.url), "utf8");
  assert.match(route, /appointments/);
  assert.doesNotMatch(route, /customerName|truckRegistration|bookingReference|email|phone|notes/u);
});

test("public booking writes use durable rate limiting and body-only cancellation tokens", async () => {
  const bookingRoute = await readFile(new URL("../app/api/bookings/route.ts", import.meta.url), "utf8");
  const cancellation = await readFile(new URL("../app/api/bookings/cancel/route.ts", import.meta.url), "utf8");
  const security = await readFile(new URL("../app/lib/submission-security.ts", import.meta.url), "utf8");
  assert.match(bookingRoute, /enforceSubmissionRateLimit/u);
  assert.match(security, /rpc\/check_submission_rate_limit/u);
  assert.match(cancellation, /body\.token/u);
  assert.doesNotMatch(cancellation, /params.*token/u);
});
