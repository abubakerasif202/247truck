import { bookingJson } from "../../../lib/booking-http";
import { BookingRepositoryError, occupiedTimes } from "../../../lib/booking-repository";
import { adelaideDateTime, BOOKING_START_TIMES, displayBookingTime, validateBookingDate } from "../../../lib/booking-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date")?.trim() || "";
  const valid = validateBookingDate(date);
  if (!valid.ok) return bookingJson(valid.message, 400, { field: "bookingDate" });
  try {
    const occupied = new Set(await occupiedTimes(date));
    const localNow = adelaideDateTime();
    const appointments = BOOKING_START_TIMES.map((time) => ({
      time,
      label: displayBookingTime(time),
      available: !occupied.has(time) && !(date === localNow.date && time <= localNow.time),
    }));
    return bookingJson("Availability loaded.", 200, { date, appointments });
  } catch (error) {
    console.error("[bookings] Availability lookup failed", { kind: error instanceof BookingRepositoryError ? error.kind : "unknown" });
    return bookingJson("Appointment availability is temporarily unavailable.", 503);
  }
}
