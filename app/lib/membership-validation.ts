export type MembershipApplication = {
  fullName: string;
  companyName: string;
  email: string;
  phone: string;
  abn: string;
  truckRegistration: string;
  vehicleType: string;
  fleetSize: string;
  operatingArea: string;
  notes: string;
  state: string;
  postcode: string;
  serviceNeeds: string;
  currentProvider: string;
  fleetAccount: string;
  scheduledService: string;
  emergencySupport: string;
  submissionId: string;
};

type ValidationResult =
  | { data: MembershipApplication }
  | { error: string; field: string };

function text(value: unknown, max: number, multiline = false) {
  if (typeof value !== "string") return "";
  const cleaned = value.normalize("NFKC").replace(
    multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu : /[\u0000-\u001F\u007F]/gu,
    "",
  ).trim();
  return (multiline ? cleaned.replace(/\r\n?/gu, "\n") : cleaned.replace(/\s+/gu, " ")).slice(0, max);
}

export function validateMembershipApplication(body: Record<string, unknown>): ValidationResult {
  const data: MembershipApplication = {
    fullName: text(body.fullName, 120),
    companyName: text(body.companyName, 160),
    email: text(body.email, 254).toLowerCase(),
    phone: text(body.phone, 30),
    abn: text(body.abn, 20),
    truckRegistration: text(body.truckRegistration, 20).toUpperCase(),
    vehicleType: text(body.vehicleType, 80),
    fleetSize: text(body.fleetSize, 40),
    operatingArea: text(body.operatingArea, 200),
    notes: text(body.notes, 2_000, true),
    state: text(body.state, 50), postcode: text(body.postcode, 4),
    serviceNeeds: text(body.serviceNeeds, 2_000, true), currentProvider: text(body.currentProvider, 160),
    fleetAccount: text(body.fleetAccount, 20), scheduledService: text(body.scheduledService, 20), emergencySupport: text(body.emergencySupport, 20),
    submissionId: text(body.submissionId, 36),
  };

  if (data.fullName.length < 2) return { error: "Please enter your full name.", field: "fullName" };
  if (data.companyName.length < 2) return { error: "Please enter your business or company name.", field: "companyName" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(data.email)) return { error: "Please enter a valid email address.", field: "email" };
  const digits = data.phone.replace(/\D/gu, "");
  if (digits.length < 8 || digits.length > 15 || !/^[+()\d .-]+$/u.test(data.phone)) return { error: "Please enter a valid mobile number.", field: "phone" };
  if (!/^[A-Z0-9 -]{2,20}$/u.test(data.truckRegistration)) return { error: "Please enter a valid truck registration.", field: "truckRegistration" };
  if (data.vehicleType.length < 2) return { error: "Please enter the vehicle type.", field: "vehicleType" };
  if (data.operatingArea.length < 2) return { error: "Please enter the operating area.", field: "operatingArea" };
  if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/u.test(data.state)) return { error: "Please enter a valid state or territory.", field: "state" };
  if (!/^\d{4}$/u.test(data.postcode)) return { error: "Please enter a valid postcode.", field: "postcode" };
  if (data.serviceNeeds.length < 2) return { error: "Please describe your roadside assistance requirements.", field: "serviceNeeds" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(data.submissionId)) return { error: "Please refresh and submit the form again.", field: "submissionId" };
  if (data.abn && !/^(?:\d[ -]?){10}\d$/u.test(data.abn)) return { error: "Please enter a valid 11-digit ABN.", field: "abn" };
  if (body.consent !== true) return { error: "Please provide consent before submitting.", field: "consent" };
  return { data };
}
