"use client";

import { useEffect, useRef, useState } from "react";
import { PHONE_DISPLAY, PHONE_HREF } from "../site-data";

type Booking = { reference: string; service: string; dateLabel: string; timeLabel: string; status: string };

export function CancellationClient() {
  const token = useRef("");
  const [booking, setBooking] = useState<Booking | null>(null);
  const [message, setMessage] = useState("Loading booking…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const fragmentToken = window.location.hash.slice(1);
    token.current = fragmentToken;
    if (!fragmentToken) { Promise.resolve().then(() => setMessage("This cancellation link is invalid.")); return; }
    const controller = new AbortController();
    fetch("/api/bookings/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lookup", token: fragmentToken }), signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data; })
      .then((data) => { setBooking(data.booking); setMessage(""); })
      .catch((reason) => { if (reason.name !== "AbortError") setMessage(reason.message || "This cancellation link is invalid."); });
    return () => controller.abort();
  }, []);
  async function cancel() {
    if (!booking || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/bookings/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", token: token.current }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setBooking(null); setMessage(data.message);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Cancellation is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  return <section className="booking-confirmation"><span>Secure booking management</span><h1>Cancel appointment</h1>{message && <p role="status">{message}</p>}{booking && <><dl><div><dt>Reference</dt><dd>{booking.reference}</dd></div><div><dt>Service</dt><dd>{booking.service}</dd></div><div><dt>Date</dt><dd>{booking.dateLabel}</dd></div><div><dt>Appointment</dt><dd>{booking.timeLabel}</dd></div></dl><p>Cancelling immediately releases this appointment for another customer.</p><button className="button button--red" disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Confirm cancellation"}</button></>}<p>Need help? <a href={PHONE_HREF}>Call {PHONE_DISPLAY}</a>.</p></section>;
}
