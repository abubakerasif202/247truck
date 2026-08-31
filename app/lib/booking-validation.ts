import { BOOKING_SERVICE, PAYMENT_METHOD, validateBookingDateTime } from "./booking-time";

export type BookingInput = {
  service: typeof BOOKING_SERVICE;
  bookingDate: string;
  startTime: string;
  customerName: string;
  email: string;
  phone: string;
  truckRegistration: string;
  truckMake: string;
  truckModel: string;
  companyName: string;
  notes: string;
  paymentMethod: typeof PAYMENT_METHOD;
};

type BookingValidationResult =
  | { data: BookingInput; error?: never; field?: never }
  | { error: string; field: string; data?: never };

function clean(value: unknown, max: number, multiline = false) {
  if (typeof value !== "string") return "";
  const controlCharacters = multiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu
    : /[\u0000-\u001F\u007F]/gu;
  const normalized = value.normalize("NFKC").replace(controlCharacters, "").trim();
  return (multiline
    ? normalized.replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ")
    : normalized.replace(/\s+/gu, " ")
  ).slice(0, max);
}

export function validateBooking(body: Record<string, unknown>, now = new Date()): BookingValidationResult {
  if (body.service !== BOOKING_SERVICE) {
    return { error: "Only Truck Wheel Alignment can be booked online.", field: "service" } as const;
  }
  const bookingDate = clean(body.bookingDate, 10);
  const startTime = clean(body.startTime, 5);
  const dateTime = validateBookingDateTime(bookingDate, startTime, now);
  if (!dateTime.ok) return { error: dateTime.message, field: dateTime.field } as const;

  const customerName = clean(body.customerName, 120);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 30);
  const truckRegistration = clean(body.truckRegistration, 20).toUpperCase();
  if (customerName.length < 2) return { error: "Please enter the customer name.", field: "customerName" } as const;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email)) return { error: "Please enter a valid email address.", field: "email" } as const;
  const digits = phone.replace(/\D/gu, "");
  if (digits.length < 8 || digits.length > 15 || !/^[+()\d .-]+$/u.test(phone)) return { error: "Please enter a valid mobile number.", field: "phone" } as const;
  if (truckRegistration.length < 2 || !/^[A-Z0-9 -]+$/u.test(truckRegistration)) return { error: "Please enter a valid truck registration.", field: "truckRegistration" } as const;

  return {
    data: {
      service: BOOKING_SERVICE,
      bookingDate,
      startTime: dateTime.time,
      customerName,
      email,
      phone,
      truckRegistration,
      truckMake: clean(body.truckMake, 80),
      truckModel: clean(body.truckModel, 80),
      companyName: clean(body.companyName, 160),
      notes: clean(body.notes, 2_000, true),
      paymentMethod: PAYMENT_METHOD,
    } satisfies BookingInput,
  } as const;
}
