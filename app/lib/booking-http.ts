export const MAX_BOOKING_BODY_BYTES = 16_000;

export function bookingJson(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json(
    { message, ...extra },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

export function requestOriginIsValid(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(request.url).protocol.replace(":", "");
  const allowed = new Set([new URL(request.url).origin]);
  if (host) {
    try { allowed.add(new URL(`${protocol}://${host}`).origin); } catch { return false; }
  }
  try { return allowed.has(new URL(origin).origin); } catch { return false; }
}

export async function readJsonObject(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_BOOKING_BODY_BYTES) return null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BOOKING_BODY_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
