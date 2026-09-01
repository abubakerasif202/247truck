import { timingSafeEqual } from "node:crypto";
import { sendMembershipActivationEmail } from "../../../lib/membership-activation-email";
import { activateMembership } from "../../../lib/membership-repository";

export const runtime = "nodejs";
function readActivationSecret() {
  const value = process.env.MEMBERSHIP_ACTIVATION_SECRET?.trim() || "";
  return value.length >= 32 ? value : null;
}
function authorised(request: Request, expected: string) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") || "";
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
export async function POST(request: Request) {
  const activationSecret = readActivationSecret();
  if (!activationSecret || !authorised(request, activationSecret)) return Response.json({ message: "Not authorised." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ message: "Invalid request." }, { status: 400 }); }
  const applicationId = body && typeof body === "object" && "applicationId" in body ? String(body.applicationId) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(applicationId)) return Response.json({ message: "Invalid application." }, { status: 400 });
  try {
    const membership = await activateMembership(applicationId, activationSecret);
    let emailDelivered = true;
    try { await sendMembershipActivationEmail(membership); } catch { emailDelivered = false; }
    const origin = new URL(request.url).origin;
    return Response.json({ ok: true, membershipNumber: membership.membership_number, emailDelivered, cardUrl: `${origin}/membership-card#${membership.token}` }, { status: 201, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    console.error("[memberships] Activation failed", { errorName: error instanceof Error ? error.message.replace(/\([^)]*\)/gu, "") : "unknown" });
    return Response.json({ message: "Membership activation failed." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
