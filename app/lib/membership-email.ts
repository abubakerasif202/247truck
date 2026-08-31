import type { MembershipApplication } from "./membership-validation";

export async function sendMembershipApplicationEmail(data: MembershipApplication) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = (process.env.MEMBERSHIP_ADMIN_EMAIL || process.env.ENQUIRY_TO_EMAIL)?.trim();
  const from = (process.env.MEMBERSHIP_FROM_EMAIL || process.env.ENQUIRY_FROM_EMAIL)?.trim();
  if (!apiKey || !to || !from) throw new Error("Membership email is not configured");
  const lines = [
    ["Full name", data.fullName], ["Company", data.companyName], ["Email", data.email],
    ["Mobile", data.phone], ["ABN", data.abn], ["Truck registration", data.truckRegistration],
    ["Vehicle type", data.vehicleType], ["Fleet size", data.fleetSize],
    ["Operating area", data.operatingArea], ["Additional notes", data.notes],
    ["State", data.state], ["Postcode", data.postcode], ["Service needs", data.serviceNeeds],
    ["Current provider", data.currentProvider], ["Fleet account interest", data.fleetAccount],
    ["Scheduled service interest", data.scheduledService], ["Emergency support interest", data.emergencySupport],
  ].filter(([, value]) => Boolean(value)).map(([label, value]) => `${label}: ${value}`).join("\n\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], reply_to: data.email, subject: `New National Roadside Assistance Membership Application — ${data.fullName}`, text: `${lines}\n\nApplication status: Submitted — not yet activated.` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Membership email delivery failed (${response.status})`);
}
