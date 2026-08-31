"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { PHONE_DISPLAY } from "./site-data";

export type MembershipCardData = { membershipNumber: string; memberName: string; companyName?: string; truckRegistration?: string; validFrom: string; validUntil: string; status: "active" | "expired" | "cancelled" };

export function MembershipCard({ membership }: { membership: MembershipCardData }) {
  const label = membership.status.toUpperCase();
  return <article className={`membership-card membership-card--${membership.status}`} aria-label={`National Roadside Assistance membership ${label}`}>
    <header><strong>24/7 Truck Tyre Services</strong><span>National Roadside Assistance Member</span></header>
    <div className="membership-card__body"><p>{membership.companyName || membership.memberName}</p>{membership.companyName && <small>{membership.memberName}</small>}<dl><div><dt>Membership number</dt><dd>{membership.membershipNumber}</dd></div>{membership.truckRegistration && <div><dt>Registered truck / fleet</dt><dd>{membership.truckRegistration}</dd></div>}<div><dt>Valid from</dt><dd>{membership.validFrom}</dd></div><div><dt>Valid until</dt><dd>{membership.validUntil}</dd></div></dl></div>
    <footer><strong>{label}</strong><span>Roadside: {PHONE_DISPLAY}</span></footer>
  </article>;
}

export function MembershipApplicationForm() {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: "idle" | "error" | "success"; message?: string }>({ kind: "idle" });
  const startedAt = useRef<number | null>(null);
  const submissionId = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setSubmitting(true); setStatus({ kind: "idle" });
    submissionId.current ??= crypto.randomUUID();
    const data = { ...Object.fromEntries(new FormData(form)), consent: true, submissionId: submissionId.current, elapsedMs: Date.now() - (startedAt.current ?? Date.now()) };
    try {
      const response = await fetch("/api/memberships/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Your application could not be submitted.");
      form.reset(); submissionId.current = null; setStatus({ kind: "success", message: "Application received. The team will review your details. You are not an active member until activation is confirmed separately." });
    } catch (reason) { setStatus({ kind: "error", message: reason instanceof Error ? reason.message : "Your application could not be submitted." }); }
    finally { setSubmitting(false); }
  }
  return <form onSubmit={submit} onFocus={() => { startedAt.current ??= Date.now(); }} aria-busy={submitting}>
    <label className="honeypot-field" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <div className="field-grid">
      <label><span>Full name *</span><input name="fullName" autoComplete="name" required maxLength={160} /></label>
      <label><span>Business / company name *</span><input name="companyName" autoComplete="organization" required maxLength={160} /></label>
      <label><span>Email *</span><input name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} /></label>
      <label><span>Mobile *</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={24} /></label>
      <label><span>ABN</span><input name="abn" inputMode="numeric" maxLength={14} /></label>
      <label><span>Truck registration *</span><input name="truckRegistration" required maxLength={20} /></label>
      <label><span>Vehicle type(s) *</span><input name="vehicleType" required maxLength={100} /></label>
      <label><span>Fleet size</span><input name="fleetSize" inputMode="numeric" maxLength={20} /></label>
      <label><span>State / territory *</span><select name="state" required defaultValue=""><option value="" disabled>Select</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label>
      <label><span>Postcode *</span><input name="postcode" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{4}" maxLength={4} required /></label>
      <label className="field-wide"><span>Operating area *</span><input name="operatingArea" required maxLength={300} /></label>
      <label className="field-wide"><span>Expected roadside assistance requirements *</span><textarea name="serviceNeeds" rows={4} required maxLength={2000} /></label>
      <label className="field-wide"><span>Current tyre / roadside provider</span><input name="currentProvider" maxLength={160} /></label>
      <label><span>Fleet account interest</span><select name="fleetAccount" defaultValue=""><option value="">Select</option><option>Yes</option><option>No</option><option>Unsure</option></select></label>
      <label><span>Scheduled service interest</span><select name="scheduledService" defaultValue=""><option value="">Select</option><option>Yes</option><option>No</option><option>Unsure</option></select></label>
      <label><span>Emergency support interest</span><select name="emergencySupport" defaultValue=""><option value="">Select</option><option>Yes</option><option>No</option><option>Unsure</option></select></label>
      <label className="field-wide"><span>Additional notes</span><textarea name="notes" rows={4} maxLength={1500} /></label>
      <label className="field-wide consent-field"><input name="consent" type="checkbox" value="true" required /><span>I confirm these details are accurate and consent to contact about this application. *</span></label>
      <p className="field-wide form-note">Membership lasts one calendar year from activation. Application does not create active membership, pricing, or payment obligations. Read our <Link href="/privacy">privacy notice</Link>.</p>
    </div>
    {status.kind !== "idle" && <p className={status.kind === "success" ? "form-success" : "form-error"} role={status.kind === "error" ? "alert" : "status"}>{status.message}</p>}
    <button className="button button--red" disabled={submitting}>{submitting ? "Submitting…" : "Apply for membership"}</button>
  </form>;
}
