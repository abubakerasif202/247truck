create extension if not exists pgcrypto;

create table if not exists public.submission_rate_limits (
  bucket text not null,
  identity_hash text not null check (identity_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  primary key (bucket, identity_hash)
);

create or replace function public.check_submission_rate_limit(p_bucket text, p_identity_hash text, p_maximum integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  delete from public.submission_rate_limits where window_started_at < now() - interval '1 day';
  insert into public.submission_rate_limits(bucket, identity_hash, window_started_at, request_count)
  values (p_bucket, p_identity_hash, now(), 1)
  on conflict (bucket, identity_hash) do update set
    window_started_at = case when submission_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now() else submission_rate_limits.window_started_at end,
    request_count = case when submission_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1 else submission_rate_limits.request_count + 1 end
  returning request_count into current_count;
  return current_count <= p_maximum;
end $$;

revoke all on public.submission_rate_limits from anon, authenticated;
alter table public.submission_rate_limits enable row level security;
revoke all on function public.check_submission_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_submission_rate_limit(text, text, integer, integer) to service_role;

create table if not exists public.roadside_membership_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  company_name text, email text not null, phone text not null, abn text,
  truck_registration text not null, vehicle_type text not null, fleet_size text,
  operating_area text not null, notes text,
  state text not null, postcode text not null, service_needs text not null,
  current_provider text, fleet_account text, scheduled_service text, emergency_support text,
  submission_token_hash text not null unique check (submission_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'submitted' check (status in ('submitted', 'contacted', 'approved', 'declined')),
  notification_sent_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.roadside_memberships (
  id uuid primary key default gen_random_uuid(),
  membership_number text not null unique check (membership_number ~ '^247-RA-[0-9]{2}-[23456789A-HJ-NP-Z]{5}$'),
  public_access_token_hash text not null unique check (public_access_token_hash ~ '^[0-9a-f]{64}$'),
  application_id uuid references public.roadside_membership_applications(id) on delete set null,
  member_name text not null, company_name text, truck_registration text, fleet_details text,
  start_date date not null, expiry_date date not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(), cancelled_at timestamptz,
  constraint roadside_membership_one_calendar_year check (expiry_date = start_date + interval '1 year'),
  constraint roadside_membership_cancellation_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);

create index if not exists roadside_membership_applications_status_created_idx on public.roadside_membership_applications(status, created_at desc);
alter table public.roadside_membership_applications enable row level security;
alter table public.roadside_memberships enable row level security;
revoke all on public.roadside_membership_applications from anon, authenticated;
revoke all on public.roadside_memberships from anon, authenticated;

create or replace function public.activate_roadside_membership(
  p_application_id uuid, p_membership_number text, p_token_hash text, p_start_date date
) returns table(membership_number text, member_name text, email text, start_date date, expiry_date date)
language plpgsql security definer set search_path = public as $$
declare application public.roadside_membership_applications%rowtype;
begin
  select * into application from public.roadside_membership_applications where id = p_application_id for update;
  if not found then raise exception 'application_not_activatable'; end if;
  if application.status = 'approved' then
    return query update public.roadside_memberships
      set public_access_token_hash = p_token_hash where application_id = p_application_id
      returning roadside_memberships.membership_number, roadside_memberships.member_name,
        application.email, roadside_memberships.start_date, roadside_memberships.expiry_date;
    return;
  end if;
  if application.status not in ('submitted', 'contacted') then raise exception 'application_not_activatable'; end if;
  update public.roadside_membership_applications set status = 'approved', updated_at = now() where id = p_application_id;
  return query
    insert into public.roadside_memberships(
      membership_number, public_access_token_hash, application_id, member_name, company_name,
      truck_registration, fleet_details, start_date, expiry_date, status
    ) values (
      p_membership_number, p_token_hash, application.id, application.full_name, application.company_name,
      application.truck_registration, concat_ws(' · ', application.vehicle_type, application.fleet_size),
      p_start_date, (p_start_date + interval '1 year')::date, 'active'
    ) returning roadside_memberships.membership_number, roadside_memberships.member_name,
      application.email, roadside_memberships.start_date, roadside_memberships.expiry_date;
end $$;

revoke all on function public.activate_roadside_membership(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.activate_roadside_membership(uuid, text, text, date) to service_role;
