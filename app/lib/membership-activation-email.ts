import { SITE_URL } from "../site-data";

export async function sendMembershipActivationEmail(membership: { membership_number: string; member_name: string; email: string; start_date: string; expiry_date: string; token: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.MEMBERSHIP_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL)?.trim();
  if (!apiKey || !from) throw new Error("Membership email is not configured");
  const cardUrl = `${process.env.NEXT_PUBLIC_SITE_URL?.trim() || SITE_URL}/membership-card#${membership.token}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [membership.email], subject: `National Roadside Assistance Membership Active — ${membership.membership_number}`, text: `Hello ${membership.member_name},\n\nYour one-year National Roadside Assistance Membership is active.\n\nMembership number: ${membership.membership_number}\nValid from: ${membership.start_date}\nValid until: ${membership.expiry_date}\n\nView Membership Card:\n${cardUrl}\n\nRoadside phone: +61 452 636 802` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Membership activation email failed (${response.status})`);
}
