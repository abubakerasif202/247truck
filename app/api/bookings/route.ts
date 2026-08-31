import { sendBookingEmails } from "../../lib/booking-email";
import { bookingJson, readJsonObject, requestOriginIsValid } from "../../lib/booking-http";
import { BookingRepositoryError, insertBooking } from "../../lib/booking-repository";
import { createBookingReference, createCancellationToken, hashCancellationToken } from "../../lib/booking-security";
import { displayBookingDate, displayBookingTime } from "../../lib/booking-time";
import { validateBooking } from "../../lib/booking-validation";
import { automatedSubmission, enforceSubmissionRateLimit } from "../../lib/submission-security";

export const runtime = "nodejs";

function siteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try { return new URL(configured).origin; } catch { /* use request origin */ }
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!requestOriginIsValid(request)) return bookingJson("This booking could not be verified. Please refresh and try again.", 400);
  const body = await readJsonObject(request);
  if (!body) return bookingJson("The booking contains invalid data.", 400);
  if (automatedSubmission(body)) return bookingJson("Please wait a moment, then submit the booking again.", 400);
  const validated = validateBooking(body);
  if (validated.error !== undefined) return bookingJson(validated.error, 400, { field: validated.field });
  const bookingInput = validated.data;

  try {
    if (!await enforceSubmissionRateLimit(request, "wheel-alignment", `${bookingInput.email}|${bookingInput.phone}`)) {
      return bookingJson("Too many booking attempts were submitted. Please try again in 10 minutes.", 429);
    }
  } catch {
    return bookingJson("Booking is temporarily unavailable. Please call us instead.", 503);
  }

  const reference = createBookingReference(bookingInput.bookingDate);
  const cancellationToken = createCancellationToken();
  try {
    const booking = await insertBooking(bookingInput, reference, hashCancellationToken(cancellationToken));
    const cancellationUrl = `${siteOrigin(request)}/cancel-booking#${cancellationToken}`;
    let emailDelivered = true;
    try {
      await sendBookingEmails(booking, cancellationUrl);
    } catch (error) {
      emailDelivered = false;
      console.error("[bookings] Confirmed booking email delivery failed", {
        bookingReference: booking.bookingReference,
        errorName: error instanceof Error ? error.message : "unknown",
      });
    }
    return bookingJson("Your Truck Wheel Alignment booking is confirmed.", 201, {
      ok: true,
      emailDelivered,
      booking: {
        reference: booking.bookingReference,
        service: "Truck Wheel Alignment",
        date: booking.bookingDate,
        dateLabel: displayBookingDate(booking.bookingDate),
        startTime: booking.startTime,
        timeLabel: displayBookingTime(booking.startTime),
        truckRegistration: booking.truckRegistration,
        customerName: booking.customerName,
        payment: "Pay at workshop",
      },
    });
  } catch (error) {
    const kind = error instanceof BookingRepositoryError ? error.kind : "database";
    if (kind === "occupied") return bookingJson("That appointment has just been booked. Please choose another time.", 409, { field: "startTime" });
    console.error("[bookings] Booking creation failed", { kind });
    return bookingJson("Booking is temporarily unavailable. Please call us instead.", 503);
  }
}
