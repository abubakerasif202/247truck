import { bookingJson, requestOriginIsValid } from "../../../lib/booking-http";
import { BookingRepositoryError, cancelBooking, findBookingForCancellation } from "../../../lib/booking-repository";
import { hashCancellationToken, validCancellationToken } from "../../../lib/booking-security";
import { displayBookingDate, displayBookingTime } from "../../../lib/booking-time";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!requestOriginIsValid(request)) return bookingJson("This request could not be verified.", 400);
  let body: { token?: unknown; action?: unknown };
  try { body = await request.json(); } catch { return bookingJson("This cancellation request is invalid.", 400); }
  const token = typeof body.token === "string" ? body.token : "";
  if (!validCancellationToken(token)) return bookingJson("This cancellation link is invalid.", 404);
  const hash = hashCancellationToken(token);
  try {
    if (body.action === "lookup") {
      const booking = await findBookingForCancellation(hash);
      if (!booking) return bookingJson("This cancellation link is invalid or has expired.", 404);
      return bookingJson("Please confirm whether you want to cancel this appointment.", 200, { booking: { reference: booking.bookingReference, service: "Truck Wheel Alignment", dateLabel: displayBookingDate(booking.bookingDate), timeLabel: displayBookingTime(booking.startTime), status: booking.status } });
    }
    if (body.action === "cancel") {
      const booking = await cancelBooking(hash);
      return bookingJson("The Truck Wheel Alignment appointment has been cancelled.", 200, { ok: true, booking: { reference: booking.bookingReference, status: booking.status } });
    }
    return bookingJson("This cancellation request is invalid.", 400);
  } catch (error) {
    const kind = error instanceof BookingRepositoryError ? error.kind : "database";
    if (kind === "not_found") return bookingJson("This booking is already cancelled or the link is invalid.", 409);
    return bookingJson("Cancellation is temporarily unavailable. Please call us.", 503);
  }
}
