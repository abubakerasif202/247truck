"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";

type Slot = { time: string; label: string; available: boolean };
type Confirmation = { bookingReference: string; bookingDate: string; appointmentTime: string; emailDelivered: boolean };
const steps = ["Select Date", "Select Appointment", "Truck Details", "Customer Details", "Review Booking"];

function localDate(days = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Adelaide", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const base = `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
  const [year, month, day] = base.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function formatBookingDate(iso: string) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Adelaide" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function WheelAlignmentBooking() {
  const [step, setStep] = useState(0);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [review, setReview] = useState<Record<string, string>>({});
  const startedAt = useRef<number | null>(null);
  const min = useMemo(() => localDate(), []);
  const max = useMemo(() => localDate(30), []);

  async function changeDate(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.value;
    startedAt.current ??= Date.now();
    setDate(selected); setTime(""); setSlots([]); setError("");
    if (!selected) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/bookings/availability?date=${encodeURIComponent(selected)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setSlots(data.appointments ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Appointments could not be loaded."); }
    finally { setLoading(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 4) {
      const current = event.currentTarget.querySelector<HTMLFieldSetElement>("fieldset:not([hidden])");
      const controls = Array.from(current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ?? []);
      if (!controls.every((control) => control.reportValidity())) return;
      if (step === 3) setReview(Object.fromEntries(Array.from(new FormData(event.currentTarget).entries()).map(([key, value]) => [key, String(value)])));
      setStep((value) => value + 1); return;
    }
    setLoading(true); setError("");
    const form = event.currentTarget;
    const payload = { ...Object.fromEntries(new FormData(form)), elapsedMs: Date.now() - (startedAt.current ?? Date.now()) };
    try {
      const response = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, service: "truck_wheel_alignment", bookingDate: date, startTime: time }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "The booking could not be confirmed.");
      setConfirmation({ bookingReference: result.booking.reference, bookingDate: result.booking.dateLabel ?? formatBookingDate(date), appointmentTime: result.booking.timeLabel ?? time, emailDelivered: result.emailDelivered !== false });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The booking could not be confirmed."); }
    finally { setLoading(false); }
  }

  if (confirmation) return <section className="booking-confirmation" role="status"><span>Booking confirmed</span><h2>Truck Wheel Alignment</h2><p className="booking-reference">{confirmation.bookingReference}</p><dl><div><dt>Date</dt><dd>{confirmation.bookingDate}</dd></div><div><dt>Appointment</dt><dd>{confirmation.appointmentTime}</dd></div><div><dt>Payment</dt><dd>Pay at workshop</dd></div></dl><p>{confirmation.emailDelivered ? "A confirmation has been sent to your email." : "Your booking is confirmed, but the email could not be delivered. Please save this reference."} Keep your reference for workshop enquiries.</p></section>;

  return <form className="booking-shell" onSubmit={submit} onFocus={() => { startedAt.current ??= Date.now(); }} noValidate>
    <label className="honeypot-field" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <div className="booking-service"><span>Workshop booking</span><strong>Truck Wheel Alignment</strong><small>Payment: Pay at workshop</small></div>
    <ol className="booking-progress" aria-label="Booking progress">{steps.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""} aria-current={index === step ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <fieldset hidden={step !== 0}><legend>Select date</legend><p>Workshop appointments are available Monday to Saturday, up to 30 days ahead.</p><label><span>Booking date *</span><input type="date" value={date} min={min} max={max} onChange={changeDate} required /></label></fieldset>
    <fieldset hidden={step !== 1}><legend>Available appointments</legend>{loading ? <p role="status">Checking appointments…</p> : <div className="appointment-grid">{slots.map((slot) => <button key={slot.time} type="button" disabled={!slot.available} className={time === slot.time ? "is-selected" : ""} aria-pressed={time === slot.time} onClick={() => setTime(slot.time)}><strong>{slot.label}</strong><small>{slot.available ? "Available" : "Booked"}</small></button>)}</div>}</fieldset>
    <fieldset hidden={step !== 2}><legend>Truck details</legend><div className="field-grid"><label><span>Truck registration *</span><input name="truckRegistration" autoComplete="off" required maxLength={20} /></label><label><span>Truck make</span><input name="truckMake" autoComplete="organization" maxLength={80} /></label><label><span>Truck model</span><input name="truckModel" maxLength={80} /></label><label><span>Fleet / company name</span><input name="companyName" autoComplete="organization" maxLength={160} /></label><label className="field-wide"><span>Additional notes</span><textarea name="notes" rows={4} maxLength={1500} /></label></div></fieldset>
    <fieldset hidden={step !== 3}><legend>Customer details</legend><div className="field-grid"><label><span>Customer name *</span><input name="customerName" autoComplete="name" required maxLength={160} /></label><label><span>Mobile number *</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={24} /></label><label className="field-wide"><span>Email *</span><input name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} /></label></div></fieldset>
    <fieldset hidden={step !== 4}><legend>Review booking</legend><dl className="booking-review"><div><dt>Service</dt><dd>Truck Wheel Alignment</dd></div><div><dt>Date</dt><dd>{formatBookingDate(date)}</dd></div><div><dt>Appointment</dt><dd>{slots.find((slot) => slot.time === time)?.label ?? time}</dd></div><div><dt>Truck registration</dt><dd>{review.truckRegistration}</dd></div><div><dt>Customer</dt><dd>{review.customerName}</dd></div><div><dt>Mobile</dt><dd>{review.phone}</dd></div><div><dt>Email</dt><dd>{review.email}</dd></div><div><dt>Payment</dt><dd>Pay at workshop</dd></div></dl><p>Confirming submits your appointment request and sends confirmation emails.</p></fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="booking-actions">{step > 0 && <button type="button" className="button button--ghost-dark" onClick={() => setStep((value) => value - 1)}>Back</button>}<button className="button button--red" disabled={loading || (step === 0 && !date) || (step === 1 && !time)}>{loading ? "Please wait…" : step === 4 ? "Confirm booking" : "Continue"}</button></div>
  </form>;
}
