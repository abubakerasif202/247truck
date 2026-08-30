import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { POST } from "../app/api/enquiries/route.ts";

const ENV_NAMES = [
  "RESEND_API_KEY",
  "ENQUIRY_TO_EMAIL",
  "ENQUIRY_FROM_EMAIL",
];
const originalEnvironment = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

function validFleetPayload(overrides = {}) {
  return {
    type: "fleet",
    company: "Test Fleet Pty Ltd",
    contactName: "Local Test",
    email: "local-test@example.com",
    phone: "0400000000",
    state: "SA",
    postcode: "5000",
    fleetSize: "1–5 vehicles",
    vehicleTypes: ["Rigid trucks"],
    serviceNeeds: "Roadside assistance",
    consent: true,
    website: "",
    startedAt: Date.now() - 3_000,
    elapsedMs: 3_000,
    ...overrides,
  };
}

function enquiryRequest(payload = validFleetPayload()) {
  return new Request("https://www.247trucktyreservices.com.au/api/enquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.247trucktyreservices.com.au",
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_api_key";
  process.env.ENQUIRY_TO_EMAIL = "admin@247trucktyreservices.com.au";
  process.env.ENQUIRY_FROM_EMAIL =
    "24/7 Truck Tyre Services <enquiries@247trucktyreservices.com.au>";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  for (const name of ENV_NAMES) {
    const originalValue = originalEnvironment[name];
    if (originalValue === undefined) delete process.env[name];
    else process.env[name] = originalValue;
  }
});

test("reports a configuration delivery error without calling Resend", async () => {
  delete process.env.ENQUIRY_FROM_EMAIL;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({ id: "should-not-send" });
  };
  const errors = [];
  console.error = (...values) => errors.push(values);

  const response = await POST(enquiryRequest());
  const result = await response.json();

  assert.equal(response.status, 503);
  assert.equal(fetchCalled, false);
  assert.match(result.message, /temporarily unavailable/i);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /configuration/i);
});

test("validates consent before attempting delivery", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({ id: "should-not-send" });
  };

  const response = await POST(enquiryRequest(validFleetPayload({ consent: false })));
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.field, "consent");
  assert.equal(fetchCalled, false);
});

test("uses elapsed form time so client clock skew does not reject a submission", async () => {
  globalThis.fetch = async () =>
    Response.json({ id: "email_test_clock_skew" }, { status: 200 });

  const response = await POST(
    enquiryRequest(
      validFleetPayload({
        startedAt: Date.now() + 60 * 60 * 1_000,
        elapsedMs: 3_000,
      }),
    ),
  );

  assert.equal(response.status, 200);
});

test("rejects cross-origin submissions before validation or delivery", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({ id: "should-not-send" });
  };
  const request = new Request(
    "https://www.247trucktyreservices.com.au/api/enquiries",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious.example",
      },
      body: JSON.stringify(validFleetPayload()),
    },
  );

  const response = await POST(request);

  assert.equal(response.status, 400);
  assert.equal(fetchCalled, false);
});

test("sends a valid fleet registration through Resend", async () => {
  let providerRequest;
  globalThis.fetch = async (input, init) => {
    providerRequest = { input, init };
    return Response.json({ id: "email_test_123" }, { status: 200 });
  };

  const response = await POST(enquiryRequest());
  const result = await response.json();
  const providerPayload = JSON.parse(providerRequest.init.body);

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(providerRequest.input, "https://api.resend.com/emails");
  assert.equal(providerRequest.init.headers.Authorization, "Bearer test_api_key");
  assert.equal(
    providerPayload.from,
    "24/7 Truck Tyre Services <enquiries@247trucktyreservices.com.au>",
  );
  assert.deepEqual(providerPayload.to, ["admin@247trucktyreservices.com.au"]);
  assert.equal(providerPayload.reply_to, "local-test@example.com");
  assert.match(providerPayload.subject, /fleet service enquiry/i);
  assert.match(providerPayload.text, /Test Fleet Pty Ltd/);
});

test("logs a redacted provider failure and returns a delivery error", async () => {
  globalThis.fetch = async () =>
    Response.json(
      { name: "validation_error", message: "Sender domain is not verified" },
      { status: 403 },
    );
  const errors = [];
  console.error = (...values) => errors.push(values);

  const response = await POST(enquiryRequest());
  const result = await response.json();

  assert.equal(response.status, 502);
  assert.match(result.message, /could not deliver/i);
  assert.equal(errors.length, 1);
  const loggedDetails = JSON.stringify(errors[0]);
  assert.match(loggedDetails, /validation_error/);
  assert.doesNotMatch(loggedDetails, /test_api_key|local-test@example.com/);
});
