import type { MembershipApplication } from "./membership-validation";
import { adelaideBusinessDate, derivePublicAccessToken, generateMembershipNumber, hashPublicAccessToken, membershipStatus } from "./membership-domain";
import { createHash } from "node:crypto";

type MembershipRow = {
  membership_number: string;
  member_name: string;
  company_name: string | null;
  truck_registration: string | null;
  fleet_details: string | null;
  start_date: string;
  expiry_date: string;
  status: "active" | "cancelled";
};

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/u, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Membership storage is not configured");
  return { url, key };
}

async function supabase(path: string, init: RequestInit) {
  const { url, key } = config();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function createMembershipApplication(data: MembershipApplication) {
  const submissionHash = createHash("sha256").update(data.submissionId, "utf8").digest("hex");
  const response = await supabase("roadside_membership_applications", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      full_name: data.fullName, company_name: data.companyName || null, email: data.email,
      phone: data.phone, abn: data.abn || null, truck_registration: data.truckRegistration,
      vehicle_type: data.vehicleType, fleet_size: data.fleetSize || null,
      operating_area: data.operatingArea, notes: data.notes || null,
      state: data.state, postcode: data.postcode, service_needs: data.serviceNeeds,
      current_provider: data.currentProvider || null, fleet_account: data.fleetAccount || null,
      scheduled_service: data.scheduledService || null, emergency_support: data.emergencySupport || null,
      submission_token_hash: submissionHash,
    }),
  });
  if (response.status === 409) {
    const existing = await supabase(`roadside_membership_applications?submission_token_hash=eq.${submissionHash}&select=notification_sent_at&limit=1`, { method: "GET" });
    if (!existing.ok) throw new Error(`Membership application lookup failed (${existing.status})`);
    const rows = await existing.json() as Array<{ notification_sent_at: string | null }>;
    return { created: false, needsNotification: !rows[0]?.notification_sent_at };
  }
  if (!response.ok) throw new Error(`Membership application storage failed (${response.status})`);
  return { created: true, needsNotification: true };
}

export async function markMembershipApplicationNotified(submissionId: string) {
  const hash = createHash("sha256").update(submissionId, "utf8").digest("hex");
  const response = await supabase(`roadside_membership_applications?submission_token_hash=eq.${hash}`, { method: "PATCH", body: JSON.stringify({ notification_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  if (!response.ok) throw new Error(`Membership notification update failed (${response.status})`);
}

export async function findPublicMembership(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const hash = hashPublicAccessToken(token);
  const fields = "membership_number,member_name,company_name,truck_registration,fleet_details,start_date,expiry_date,status";
  const response = await supabase(`roadside_memberships?public_access_token_hash=eq.${hash}&select=${fields}&limit=1`, { method: "GET" });
  if (!response.ok) throw new Error(`Membership lookup failed (${response.status})`);
  const rows = await response.json() as MembershipRow[];
  const row = rows[0];
  if (!row) return null;
  return {
    membershipNumber: row.membership_number,
    memberName: row.member_name,
    companyName: row.company_name,
    truckRegistration: row.truck_registration,
    fleetDetails: row.fleet_details,
    validFrom: row.start_date,
    validUntil: row.expiry_date,
    status: membershipStatus(row.status, row.expiry_date),
  };
}

export async function activateMembership(applicationId: string, activationSecret: string) {
  const token = derivePublicAccessToken(applicationId, activationSecret);
  const membershipNumber = generateMembershipNumber();
  const response = await supabase("rpc/activate_roadside_membership", {
    method: "POST",
    body: JSON.stringify({ p_application_id: applicationId, p_membership_number: membershipNumber, p_token_hash: hashPublicAccessToken(token), p_start_date: adelaideBusinessDate() }),
  });
  if (!response.ok) throw new Error(`Membership activation failed (${response.status})`);
  const rows = await response.json() as Array<{ membership_number: string; member_name: string; email: string; start_date: string; expiry_date: string }>;
  if (!rows[0]) throw new Error("Membership activation returned no record");
  return { ...rows[0], token };
}
