export const ADELAIDE_TIME_ZONE = "Australia/Adelaide";
export const BOOKING_SERVICE = "truck_wheel_alignment" as const;
export const PAYMENT_METHOD = "pay_at_workshop" as const;
export const BOOKING_START_TIMES = ["08:00", "10:00", "12:00", "14:00", "16:00"] as const;

export type BookingStartTime = (typeof BOOKING_START_TIMES)[number];

type AdelaideDateTime = {
  date: string;
  time: string;
};

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ADELAIDE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function adelaideDateTime(now = new Date()): AdelaideDateTime {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

export function isSunday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

export function validateBookingDateTime(
  date: string,
  time: string,
  now = new Date(),
): { ok: true; time: BookingStartTime } | { ok: false; message: string; field: "bookingDate" | "startTime" } {
  if (!isIsoDate(date)) {
    return { ok: false, message: "Please choose a valid booking date.", field: "bookingDate" };
  }
  if (!(BOOKING_START_TIMES as readonly string[]).includes(time)) {
    return { ok: false, message: "Please choose one of the available appointment times.", field: "startTime" };
  }
  if (isSunday(date)) {
    return { ok: false, message: "The workshop is closed on Sundays.", field: "bookingDate" };
  }

  const localNow = adelaideDateTime(now);
  if (date < localNow.date) {
    return { ok: false, message: "Past dates cannot be booked.", field: "bookingDate" };
  }
  if (date > addCalendarDays(localNow.date, 30)) {
    return { ok: false, message: "Bookings are available up to 30 days in advance.", field: "bookingDate" };
  }
  if (date === localNow.date && time <= localNow.time) {
    return { ok: false, message: "That appointment time has already passed in Adelaide.", field: "startTime" };
  }

  return { ok: true, time: time as BookingStartTime };
}

export function validateBookingDate(date: string, now = new Date()) {
  if (!isIsoDate(date)) return { ok: false, message: "Please choose a valid booking date." } as const;
  if (isSunday(date)) return { ok: false, message: "The workshop is closed on Sundays." } as const;
  const today = adelaideDateTime(now).date;
  if (date < today) return { ok: false, message: "Past dates cannot be booked." } as const;
  if (date > addCalendarDays(today, 30)) return { ok: false, message: "Bookings are available up to 30 days in advance." } as const;
  return { ok: true } as const;
}

export function displayBookingDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: ADELAIDE_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function displayBookingTime(time: string) {
  const hour = Number(time.slice(0, 2));
  return `${hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`;
}
