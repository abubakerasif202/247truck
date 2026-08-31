import { createHash } from "node:crypto";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/u, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Submission security is not configured");
  return { url, key };
}

export function automatedSubmission(body: Record<string, unknown>) {
  if (typeof body.website === "string" && body.website.trim()) return true;
  return typeof body.elapsedMs !== "number" || !Number.isFinite(body.elapsedMs) || body.elapsedMs < 1_500 || body.elapsedMs > 86_400_000;
}

export async function enforceSubmissionRateLimit(request: Request, bucket: string, identity: string, maximum = 5) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  const hashes = [createHash("sha256").update(ip, "utf8").digest("hex"), createHash("sha256").update(identity.toLowerCase(), "utf8").digest("hex")];
  const { url, key } = config();
  const responses = await Promise.all(hashes.map((hash, index) => fetch(`${url}/rest/v1/rpc/check_submission_rate_limit`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_bucket: `${bucket}:${index === 0 ? "ip" : "identity"}`, p_identity_hash: hash, p_maximum: maximum, p_window_seconds: 600 }),
    signal: AbortSignal.timeout(10_000), cache: "no-store",
  })));
  if (responses.some((response) => !response.ok)) throw new Error("Rate limit storage failed");
  return (await Promise.all(responses.map((response) => response.json()))).every(Boolean);
}
