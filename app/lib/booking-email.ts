import "server-only";

import { displayBookingDate, displayBookingTime } from "./booking-time";
import type { StoredBooking } from "./booking-repository";

const BUSINESS_PHONE = "+61 452 636 802";
const WORKSHOP = "24/7 Truck Tyre Services, Regency Park, South Australia";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value) && !/[\r\n]/u.test(value);
}

async function sendEmail(payload: { to: string; replyTo?: string; subject: string; text: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BOOKING_FROM_EMAIL?.trim() || process.env.ENQUIRY_FROM_EMAIL?.trim();
  if (!apiKey || !from || !validEmail(payload.to)) throw new Error("email_configuration");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [payload.to],
      ...(payload.replyTo && validEmail(payload.replyTo) ? { reply_to: payload.replyTo } : {}),
      subject: payload.subject,
      text: payload.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("email_delivery");
}

function bookingSummary(booking: StoredBooking) {
  return [
    `Booking reference: ${booking.bookingReference}`,
    "Service: Truck Wheel Alignment",
    `Date: ${displayBookingDate(booking.bookingDate)}`,
    `Appointment: ${displayBookingTime(booking.startTime)}`,
    `Truck registration: ${booking.truckRegistration}`,
    `Customer: ${booking.customerName}`,
    "Payment: Pay at workshop",
    `Phone: ${BUSINESS_PHONE}`,
    `Workshop: ${WORKSHOP}`,
  ].join("\n");
}

export async function sendBookingEmails(booking: StoredBooking, cancellationUrl: string) {
  const customer = sendEmail({
    to: booking.email,
    subject: `Truck Wheel Alignment Booking Confirmed — ${booking.bookingReference}`,
    text: `Your Truck Wheel Alignment booking is confirmed.\n\n${bookingSummary(booking)}\n\nPlease call ${BUSINESS_PHONE} if your plans change.`,
  });
  const optional = [
    booking.companyName && `Fleet/company: ${booking.companyName}`,
    booking.truckMake && `Truck make: ${booking.truckMake}`,
    booking.truckModel && `Truck model: ${booking.truckModel}`,
    booking.notes && `Additional notes: ${booking.notes}`,
  ].filter(Boolean).join("\n");
  const adminEmail = process.env.BOOKING_ADMIN_EMAIL?.trim() || process.env.ENQUIRY_TO_EMAIL?.trim();
  if (!adminEmail || !validEmail(adminEmail)) throw new Error("email_configuration");
  const admin = sendEmail({
    to: adminEmail,
    replyTo: booking.email,
    subject: `New Truck Wheel Alignment Booking — ${displayBookingDate(booking.bookingDate)} ${displayBookingTime(booking.startTime)}`,
    text: `${bookingSummary(booking)}\nEmail: ${booking.email}\nMobile: ${booking.phone}${optional ? `\n${optional}` : ""}\n\nSecure cancellation link:\n${cancellationUrl}`,
  });
  await Promise.all([customer, admin]);
}
