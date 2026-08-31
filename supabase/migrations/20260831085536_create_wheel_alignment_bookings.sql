create extension if not exists pgcrypto;

create table public.wheel_alignment_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  service text not null default 'truck_wheel_alignment'
    check (service = 'truck_wheel_alignment'),
  booking_date date not null
    check (extract(isodow from booking_date) between 1 and 6),
  start_time time without time zone not null
    check (start_time in (time '08:00', time '10:00', time '12:00', time '14:00', time '16:00')),
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (char_length(phone) between 8 and 30),
  truck_registration text not null check (char_length(truck_registration) between 2 and 20),
  truck_make text,
  truck_model text,
  company_name text,
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  payment_method text not null default 'pay_at_workshop' check (payment_method = 'pay_at_workshop'),
  cancellation_token_hash text not null unique check (cancellation_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint wheel_alignment_cancellation_state check (
    (status = 'confirmed' and cancelled_at is null) or
    (status = 'cancelled' and cancelled_at is not null)
  )
);

create unique index wheel_alignment_one_active_booking_per_slot
  on public.wheel_alignment_bookings (booking_date, start_time)
  where status = 'confirmed';

create index wheel_alignment_bookings_date_status
  on public.wheel_alignment_bookings (booking_date, status);

alter table public.wheel_alignment_bookings enable row level security;
revoke all on table public.wheel_alignment_bookings from anon, authenticated;
grant select, insert, update, delete on table public.wheel_alignment_bookings to service_role;

comment on table public.wheel_alignment_bookings is
  'Server-managed Truck Wheel Alignment appointments. No browser role has direct access.';
comment on index public.wheel_alignment_one_active_booking_per_slot is
  'Database-level concurrency guard; cancellation releases the appointment.';
