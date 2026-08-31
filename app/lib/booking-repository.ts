import "server-only";

import type { BookingInput } from "./booking-validation";

export type StoredBooking = BookingInput & {
  id: string;
  bookingReference: string;
  status: "confirmed" | "cancelled";
};

type DatabaseBooking = {
  id: string;
  booking_reference: string;
  service: BookingInput["service"];
  booking_date: string;
  start_time: string;
  customer_name: string;
  email: string;
  phone: string;
  truck_registration: string;
  truck_make: string | null;
  truck_model: string | null;
  company_name: string | null;
  notes: string | null;
  status: "confirmed" | "cancelled";
  payment_method: BookingInput["paymentMethod"];
};

export class BookingRepositoryError extends Error {
  constructor(public readonly kind: "configuration" | "occupied" | "not_found" | "database") {
    super(kind);
  }
}

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/u, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new BookingRepositoryError("configuration");
  return { url, key };
}

async function supabase(path: string, init: RequestInit = {}) {
  const { url, key } = configuration();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
}

function fromDatabase(row: DatabaseBooking): StoredBooking {
  return {
    id: row.id,
    bookingReference: row.booking_reference,
    service: row.service,
    bookingDate: row.booking_date,
    startTime: row.start_time.slice(0, 5),
    customerName: row.customer_name,
    email: row.email,
    phone: row.phone,
    truckRegistration: row.truck_registration,
    truckMake: row.truck_make ?? "",
    truckModel: row.truck_model ?? "",
    companyName: row.company_name ?? "",
    notes: row.notes ?? "",
    status: row.status,
    paymentMethod: row.payment_method,
  };
}

export async function occupiedTimes(date: string) {
  const query = new URLSearchParams({
    select: "start_time",
    booking_date: `eq.${date}`,
    status: "eq.confirmed",
  });
  const response = await supabase(`wheel_alignment_bookings?${query}`);
  if (!response.ok) throw new BookingRepositoryError("database");
  const rows = (await response.json()) as Array<{ start_time: string }>;
  return rows.map((row) => row.start_time.slice(0, 5));
}

export async function insertBooking(
  booking: BookingInput,
  bookingReference: string,
  cancellationTokenHash: string,
) {
  const response = await supabase("wheel_alignment_bookings", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      booking_reference: bookingReference,
      service: booking.service,
      booking_date: booking.bookingDate,
      start_time: booking.startTime,
      customer_name: booking.customerName,
      email: booking.email,
      phone: booking.phone,
      truck_registration: booking.truckRegistration,
      truck_make: booking.truckMake || null,
      truck_model: booking.truckModel || null,
      company_name: booking.companyName || null,
      notes: booking.notes || null,
      payment_method: booking.paymentMethod,
      cancellation_token_hash: cancellationTokenHash,
    }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    if (response.status === 409 || error?.code === "23505") throw new BookingRepositoryError("occupied");
    throw new BookingRepositoryError("database");
  }
  const rows = (await response.json()) as DatabaseBooking[];
  if (!rows[0]) throw new BookingRepositoryError("database");
  return fromDatabase(rows[0]);
}

export async function findBookingForCancellation(tokenHash: string) {
  const query = new URLSearchParams({
    select: "id,booking_reference,service,booking_date,start_time,customer_name,email,phone,truck_registration,truck_make,truck_model,company_name,notes,status,payment_method",
    cancellation_token_hash: `eq.${tokenHash}`,
    limit: "1",
  });
  const response = await supabase(`wheel_alignment_bookings?${query}`);
  if (!response.ok) throw new BookingRepositoryError("database");
  const rows = (await response.json()) as DatabaseBooking[];
  return rows[0] ? fromDatabase(rows[0]) : null;
}

export async function cancelBooking(tokenHash: string) {
  const query = new URLSearchParams({ cancellation_token_hash: `eq.${tokenHash}`, status: "eq.confirmed" });
  const response = await supabase(`wheel_alignment_bookings?${query}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "cancelled", cancelled_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new BookingRepositoryError("database");
  const rows = (await response.json()) as DatabaseBooking[];
  if (!rows[0]) throw new BookingRepositoryError("not_found");
  return fromDatabase(rows[0]);
}
