import { createMembershipApplication, markMembershipApplicationNotified } from "../../../lib/membership-repository";
import { sendMembershipApplicationEmail } from "../../../lib/membership-email";
import { validateMembershipApplication } from "../../../lib/membership-validation";
import { automatedSubmission, enforceSubmissionRateLimit } from "../../../lib/submission-security";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 24_000;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(request.url).protocol.replace(":", "");
  try { return Boolean(host) && new URL(origin).origin === new URL(`${protocol}://${host}`).origin; } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ message: "This application could not be verified." }, { status: 400 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ message: "The application must be submitted as JSON." }, { status: 400 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return Response.json({ message: "The application is too large." }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return Response.json({ message: "The application contains invalid data." }, { status: 400 }); }
  if (!body || Array.isArray(body) || typeof body !== "object") return Response.json({ message: "The application contains invalid data." }, { status: 400 });
  if (automatedSubmission(body)) return Response.json({ message: "Please wait a moment, then submit the application again." }, { status: 400 });
  const result = validateMembershipApplication(body);
  if ("error" in result) return Response.json({ message: result.error, field: result.field }, { status: 400 });
  try {
    if (!await enforceSubmissionRateLimit(request, "roadside-membership", `${result.data.email}|${result.data.phone}`)) return Response.json({ message: "Too many applications were submitted. Please try again in 10 minutes." }, { status: 429 });
    const stored = await createMembershipApplication(result.data);
    if (stored.needsNotification) {
      await sendMembershipApplicationEmail(result.data);
      await markMembershipApplicationNotified(result.data.submissionId);
    }
    return Response.json({ ok: true, status: "submitted", message: stored.created ? "Your membership application has been received for review. This is not an active membership yet." : "This membership application was already received." }, { status: stored.created ? 201 : 200 });
  } catch (error) {
    console.error("[memberships] Application processing failed", { errorName: error instanceof Error ? error.message.replace(/\([^)]*\)/gu, "") : "UnknownError" });
    return Response.json({ message: "We could not submit your application. Please call us instead." }, { status: 503 });
  }
}
