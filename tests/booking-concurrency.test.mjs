import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.SUPABASE_TEST_URL?.trim()?.replace(/\/$/u, "");
const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim();

test("concurrent database submissions cannot double-book an active slot", { skip: !url || !key }, async () => {
  const suffix = randomBytes(6).toString("hex").toUpperCase();
  const references = [`247-WA-991231-${suffix}A`, `247-WA-991231-${suffix}B`];
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const common = {
    service: "truck_wheel_alignment",
    booking_date: "4099-12-31",
    start_time: "10:00",
    customer_name: "Concurrency Test",
    email: "booking-test@example.com",
    phone: "0400000000",
    truck_registration: `TEST-${suffix.slice(0, 6)}`,
    payment_method: "pay_at_workshop",
  };

  try {
    const responses = await Promise.all(
      references.map((booking_reference, index) =>
        fetch(`${url}/rest/v1/wheel_alignment_bookings`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...common,
            booking_reference,
            cancellation_token_hash: `${String(index + 1)}${randomBytes(31).toString("hex")}0`.slice(0, 64),
          }),
        }),
      ),
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  } finally {
    const filter = encodeURIComponent(`(${references.join(",")})`);
    await fetch(`${url}/rest/v1/wheel_alignment_bookings?booking_reference=in.${filter}`, {
      method: "DELETE",
      headers,
    });
  }
});
