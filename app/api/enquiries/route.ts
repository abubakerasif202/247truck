import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 24_000;
const MIN_FILL_TIME_MS = 2_000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT_MAX = 5;

type JsonObject = Record<string, unknown>;
type RateLimitRecord = { count: number; resetAt: number };

const globalRateLimit = globalThis as typeof globalThis & {
  enquiryRateLimit?: Map<string, RateLimitRecord>;
};
const rateLimit =
  globalRateLimit.enquiryRateLimit ?? new Map<string, RateLimitRecord>();
globalRateLimit.enquiryRateLimit = rateLimit;

function json(message: string, status: number, extra?: JsonObject) {
  return NextResponse.json(
    { message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function cleanText(value: unknown, maxLength: number, multiline = false) {
  if (typeof value !== "string") return "";

  const normalized = value
    .normalize("NFKC")
    .replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "")
    .trim();

  return (multiline
    ? normalized.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ")
    : normalized.replace(/\s+/g, " ")
  ).slice(0, maxLength);
}

function cleanList(value: unknown, maxItems = 12, maxItemLength = 80) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => cleanText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function validEmail(value: string) {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value) &&
    !/[\r\n]/u.test(value)
  );
}

function validPhone(value: string) {
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 8 && digitCount <= 15 && /^[+()\d .-]+$/u.test(value);
}

function validShortText(value: string, min = 2) {
  return value.length >= min;
}

function validState(value: string) {
  return /^[A-Za-z][A-Za-z .'-]{1,49}$/u.test(value);
}

function requestOriginIsValid(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const protocol = forwardedProtocol || new URL(request.url).protocol.replace(":", "");
  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (host) {
    try {
      allowedOrigins.add(new URL(`${protocol}://${host}`).origin);
    } catch {
      return false;
    }
  }

  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function isRateLimited(ip: string, now: number) {
  if (rateLimit.size > 1_000) {
    for (const [key, record] of rateLimit) {
      if (record.resetAt <= now) rateLimit.delete(key);
    }
  }

  const record = rateLimit.get(ip);
  if (!record || record.resetAt <= now) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  record.count += 1;
  return record.count > RATE_LIMIT_MAX;
}

function validateTiming(body: JsonObject, now: number) {
  return (
    typeof body.startedAt === "number" &&
    Number.isFinite(body.startedAt) &&
    now - body.startedAt >= MIN_FILL_TIME_MS &&
    now - body.startedAt <= MAX_FORM_AGE_MS
  );
}

function validateEnquiry(body: JsonObject) {
  const type = body.type;
  if (type !== "franchise" && type !== "fleet") {
    return { error: "Please choose a valid enquiry type." } as const;
  }

  const email = cleanText(body.email, 254).toLowerCase();
  const phone = cleanText(body.phone, 24);
  const state = cleanText(body.state, 50);
  const postcode = cleanText(body.postcode, 4);
  const message = cleanText(body.message, 2_000, true);

  if (!validEmail(email)) return { error: "Please enter a valid email address.", field: "email" } as const;
  if (!validPhone(phone)) return { error: "Please enter a valid phone number.", field: "phone" } as const;
  if (!validState(state)) return { error: "Please enter a valid state or territory.", field: "state" } as const;
  if (!/^\d{4}$/u.test(postcode)) return { error: "Please enter a valid 4-digit postcode.", field: "postcode" } as const;
  if (body.consent !== true) return { error: "Please provide consent before submitting.", field: "consent" } as const;

  if (type === "franchise") {
    const firstName = cleanText(body.firstName, 80);
    const lastName = cleanText(body.lastName, 80);
    const city = cleanText(body.city, 100);
    const preferredArea = cleanText(body.preferredArea, 160);
    const businessExperience = cleanText(body.businessExperience, 1_500, true);

    if (!validShortText(firstName, 1) || !validShortText(lastName, 1)) {
      return { error: "Please enter your first and last name.", field: !validShortText(firstName, 1) ? "firstName" : "lastName" } as const;
    }
    if (!validShortText(city) || !validShortText(preferredArea)) {
      return { error: "Please enter your city and preferred franchise area.", field: !validShortText(city) ? "city" : "preferredArea" } as const;
    }
    if (!validShortText(businessExperience)) {
      return { error: "Please select your business ownership experience.", field: "businessExperience" } as const;
    }

    return {
      data: {
        type,
        firstName,
        lastName,
        email,
        phone,
        city,
        state,
        postcode,
        preferredArea,
        occupation: cleanText(body.occupation, 160),
        industryExperience: cleanText(body.industryExperience, 80),
        businessExperience,
        timeframe: cleanText(body.timeframe, 80),
        message,
      },
    } as const;
  }

  const company = cleanText(body.company, 160);
  const contactName = cleanText(body.contactName, 160);
  const fleetSize = cleanText(body.fleetSize, 40);
  const vehicleTypes = cleanList(body.vehicleTypes);
  const serviceNeeds = Array.isArray(body.serviceNeeds)
    ? cleanList(body.serviceNeeds, 12, 160)
    : [cleanText(body.serviceNeeds, 2_000, true)].filter(Boolean);
  const billingEmail = cleanText(body.billingEmail, 254).toLowerCase();
  const abn = cleanText(body.abn, 20);

  if (!validShortText(company) || !validShortText(contactName)) {
    return { error: "Please enter your company and contact name.", field: !validShortText(company) ? "company" : "contactName" } as const;
  }
  if (!fleetSize || !/^[A-Za-z0-9 +–—-]{1,40}$/u.test(fleetSize)) {
    return { error: "Please enter a valid fleet size.", field: "fleetSize" } as const;
  }
  if (vehicleTypes.length === 0 || serviceNeeds.length === 0) {
    return { error: "Please select your vehicle types and service needs.", field: vehicleTypes.length === 0 ? "vehicleTypes" : "serviceNeeds" } as const;
  }
  if (billingEmail && !validEmail(billingEmail)) {
    return { error: "Please enter a valid billing email address.", field: "billingEmail" } as const;
  }
  if (abn && !/^(?:\d[ -]?){10}\d$/u.test(abn)) {
    return { error: "Please enter a valid 11-digit ABN.", field: "abn" } as const;
  }

  return {
    data: {
      type,
      company,
      contactName,
      email,
      phone,
      state,
      postcode,
      fleetSize,
      vehicleTypes,
      serviceNeeds,
      abn,
      position: cleanText(body.position, 120),
      billingEmail,
      suburb: cleanText(body.suburb, 100),
      operatingRegions: cleanText(body.operatingRegions, 300),
      interstate: cleanText(body.interstate, 20),
      monthlyKilometres: cleanText(body.monthlyKilometres, 40),
      currentProvider: cleanText(body.currentProvider, 160),
      fleetAccount: cleanText(body.fleetAccount, 20),
      scheduledService: cleanText(body.scheduledService, 20),
      emergencySupport: cleanText(body.emergencySupport, 20),
      message,
    },
  } as const;
}

function emailText(data: Record<string, string | string[] | undefined>) {
  const labels: Record<string, string> = {
    type: "Enquiry type",
    firstName: "First name",
    lastName: "Last name",
    contactName: "Contact name",
    email: "Email",
    phone: "Phone",
    company: "Company",
    city: "City",
    state: "State",
    postcode: "Postcode",
    preferredArea: "Preferred area",
    occupation: "Current occupation / business",
    industryExperience: "Industry experience",
    businessExperience: "Business experience",
    timeframe: "Estimated start timeframe",
    fleetSize: "Fleet size",
    vehicleTypes: "Vehicle types",
    serviceNeeds: "Service needs",
    abn: "ABN",
    position: "Position / title",
    billingEmail: "Billing / admin email",
    suburb: "Head office suburb",
    operatingRegions: "Operating regions",
    interstate: "Interstate operations",
    monthlyKilometres: "Approximate monthly kilometres",
    currentProvider: "Current tyre / roadside provider",
    fleetAccount: "Fleet account interest",
    scheduledService: "Scheduled service interest",
    emergencySupport: "Emergency support interest",
    message: "Message",
  };

  return Object.entries(data)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .map(([key, value]) => `${labels[key] ?? key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n\n");
}

function validRecipient(value: string) {
  return validEmail(value.trim());
}

function validSender(value: string) {
  return (
    value.length <= 320 &&
    !/[\r\n]/u.test(value) &&
    /^(?:[^<>\r\n]+\s+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,}>?$/u.test(value)
  );
}

export async function POST(request: Request) {
  if (!requestOriginIsValid(request)) {
    return json("This enquiry could not be verified. Please refresh and try again.", 400);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return json("The enquiry is too large to submit.", 400);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json("The enquiry must be submitted as JSON.", 400);
  }

  let body: JsonObject;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json("The enquiry is too large to submit.", 400);
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as JsonObject;
  } catch {
    return json("The enquiry contains invalid data.", 400);
  }

  if (cleanText(body.website, 200)) {
    return json("Thanks. Your enquiry has been received.", 200, { ok: true });
  }

  const now = Date.now();
  if (!validateTiming(body, now)) {
    return json("Please wait a moment, then submit the enquiry again.", 400);
  }
  if (isRateLimited(clientIp(request), now)) {
    return json("Too many enquiries were submitted. Please try again in 10 minutes.", 429);
  }

  const validated = validateEnquiry(body);
  if ("error" in validated && validated.error) {
    return json(validated.error, 400, { field: "field" in validated ? validated.field : undefined });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ENQUIRY_TO_EMAIL?.trim();
  const from =
    process.env.ENQUIRY_FROM_EMAIL?.trim() ||
    "24/7 Truck Tyre Services <onboarding@resend.dev>";

  if (!apiKey || !to || !validRecipient(to) || !validSender(from)) {
    return json("Enquiry delivery is temporarily unavailable. Please call us instead.", 503);
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: validated.data.email,
        subject:
          validated.data.type === "franchise"
            ? "New franchise enquiry"
            : "New fleet service enquiry",
        text: emailText(validated.data),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return json("We could not deliver your enquiry. Please try again or call us.", 502);
    }
  } catch {
    return json("We could not deliver your enquiry. Please try again or call us.", 502);
  }

  return json("Thanks. Your enquiry has been sent to our team.", 200, { ok: true });
}
