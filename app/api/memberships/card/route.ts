import { findPublicMembership } from "../../../lib/membership-repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let token = "";
  try { const body = await request.json(); token = typeof body.token === "string" ? body.token : ""; } catch { /* invalid */ }
  try {
    const membership = await findPublicMembership(token);
    if (!membership) return Response.json({ message: "Membership not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ membership }, { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
  } catch { return Response.json({ message: "Membership lookup is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
