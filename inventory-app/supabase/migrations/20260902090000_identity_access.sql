create extension if not exists pgcrypto with schema extensions;

revoke create on schema public from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.locations (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint locations_code_check check (code in ('LON', 'REG')),
  constraint locations_name_not_blank_check check (btrim(name) <> '')
);

insert into public.locations (code, name)
values
  ('LON', 'Lonsdale'),
  ('REG', 'Regency Park');

create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null,
  location_id uuid references public.locations (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_display_name_not_blank_check check (btrim(display_name) <> ''),
  constraint user_profiles_role_check check (role in ('admin', 'manager')),
  constraint user_profiles_role_location_check check (
    (role = 'admin' and location_id is null)
    or (role = 'manager' and location_id is not null)
  )
);

create table public.manager_permissions (
  user_id uuid not null references public.user_profiles (user_id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_key),
  constraint manager_permissions_permission_key_check check (
    permission_key in (
      'inventory.view',
      'inventory.stock_in',
      'inventory.stock_out',
      'inventory.adjust',
      'inventory.view_cost',
      'inventory.edit_global_price',
      'reports.view_inventory_value'
    )
  )
);

create table public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_role text not null,
  location_id uuid references public.locations (id),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_role_check check (actor_role in ('admin', 'manager')),
  constraint audit_events_event_type_not_blank_check check (btrim(event_type) <> ''),
  constraint audit_events_entity_type_not_blank_check check (btrim(entity_type) <> '')
);

create index user_profiles_location_id_idx
  on public.user_profiles (location_id);
create index audit_events_actor_user_id_idx
  on public.audit_events (actor_user_id);
create index audit_events_location_created_at_idx
  on public.audit_events (location_id, created_at desc);
create index audit_events_event_type_created_at_idx
  on public.audit_events (event_type, created_at desc);

alter table public.locations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.manager_permissions enable row level security;
alter table public.audit_events enable row level security;

create or replace function private.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.user_profiles as profile
      where profile.user_id = (select auth.uid())
        and profile.role = 'admin'
        and profile.active
    );
$$;

create or replace function private.app_user_location_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.location_id
  from public.user_profiles as profile
  join public.locations as location
    on location.id = profile.location_id
   and location.active
  where profile.user_id = (select auth.uid())
    and profile.role = 'manager'
    and profile.active;
$$;

create or replace function private.app_has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Valid permission keys are enforced by the manager_permissions CHECK
  -- constraint; this helper only answers "is this key enabled for the caller".
  select p_permission_key is not null
    and (
      (select private.app_is_admin())
      or exists (
        select 1
        from public.user_profiles as profile
        join public.locations as location
          on location.id = profile.location_id
         and location.active
        join public.manager_permissions as permission
          on permission.user_id = profile.user_id
         and permission.permission_key = p_permission_key
         and permission.enabled
        where profile.user_id = (select auth.uid())
          and profile.role = 'manager'
          and profile.active
      )
    );
$$;

create or replace function private.prevent_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user::text in ('anon', 'authenticated', 'service_role')
    or session_user::text = 'authenticator'
  then
    raise exception 'audit events are immutable'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger audit_events_prevent_mutation
before update or delete on public.audit_events
for each row execute function private.prevent_audit_event_mutation();

create trigger audit_events_prevent_truncate
before truncate on public.audit_events
for each statement execute function private.prevent_audit_event_mutation();

create or replace function public.app_audit_event(
  p_event_type text,
  p_entity_type text,
  p_entity_id text default null,
  p_details jsonb default '{}'::jsonb,
  p_location_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_role text;
  v_actor_location_id uuid;
  v_audit_event_id uuid;
begin
  if v_actor_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'event type is required'
      using errcode = '22023';
  end if;

  if p_entity_type is null or btrim(p_entity_type) = '' then
    raise exception 'entity type is required'
      using errcode = '22023';
  end if;

  select profile.role, profile.location_id
  into v_actor_role, v_actor_location_id
  from public.user_profiles as profile
  where profile.user_id = v_actor_user_id
    and profile.active;

  if not found then
    raise exception 'active user profile required'
      using errcode = '42501';
  end if;

  if v_actor_role = 'manager' then
    if not exists (
      select 1
      from public.locations as location
      where location.id = v_actor_location_id
        and location.active
    ) then
      raise exception 'active assigned location required'
        using errcode = '42501';
    end if;

    if p_event_type not in ('LOGIN_SUCCESS', 'PASSWORD_SET') then
      raise exception 'Managers may only record their own session events directly'
        using errcode = '42501';
    end if;

    if p_location_id is not null and p_location_id <> v_actor_location_id then
      raise exception 'Managers cannot record events for another location'
        using errcode = '42501';
    end if;
  elsif v_actor_role = 'admin' then
    -- Admins are trusted to record any Phase 1 governance event. The actor is
    -- always derived from auth.uid(), so this cannot be used to impersonate.
    if p_location_id is not null and not exists (
      select 1
      from public.locations as location
      where location.id = p_location_id
        and location.active
    ) then
      raise exception 'an active location is required'
        using errcode = '22023';
    end if;
  else
    raise exception 'unsupported user role'
      using errcode = '42501';
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    location_id,
    event_type,
    entity_type,
    entity_id,
    details
  )
  values (
    v_actor_user_id,
    v_actor_role,
    case when v_actor_role = 'manager' then v_actor_location_id else p_location_id end,
    p_event_type,
    p_entity_type,
    p_entity_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_audit_event_id;

  return v_audit_event_id;
end;
$$;

revoke all on public.locations from public, anon, authenticated, service_role;
revoke all on public.user_profiles from public, anon, authenticated, service_role;
revoke all on public.manager_permissions from public, anon, authenticated, service_role;
revoke all on public.audit_events from public, anon, authenticated, service_role;

grant select on public.locations to authenticated;
grant select on public.user_profiles to authenticated;
grant select on public.manager_permissions to authenticated;
-- Audit details are arbitrary JSONB and may contain confidential operational
-- data added by future privileged writers. Managers can read their branch's
-- event metadata but never the unstructured payload through PostgREST.
grant select (
  id, actor_user_id, actor_role, location_id, event_type, entity_type,
  entity_id, created_at
) on public.audit_events to authenticated;

grant select, insert, update, delete on public.locations to service_role;
grant select, insert, update, delete on public.user_profiles to service_role;
grant select, insert, update, delete on public.manager_permissions to service_role;
grant select, insert on public.audit_events to service_role;

revoke execute on function private.app_is_admin() from public, anon, service_role;
revoke execute on function private.app_user_location_id() from public, anon, service_role;
revoke execute on function private.app_has_permission(text) from public, anon, service_role;
revoke execute on function private.prevent_audit_event_mutation() from public, anon, authenticated, service_role;
revoke execute on function public.app_audit_event(text, text, text, jsonb, uuid) from public, anon, service_role;

grant execute on function private.app_is_admin() to authenticated;
grant execute on function private.app_user_location_id() to authenticated;
grant execute on function private.app_has_permission(text) to authenticated;
grant execute on function public.app_audit_event(text, text, text, jsonb, uuid) to authenticated;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

create policy locations_select_access
on public.locations
for select
to authenticated
using (
  (select private.app_is_admin())
  or (
    active
    and id = (select private.app_user_location_id())
  )
);

create policy user_profiles_select_access
on public.user_profiles
for select
to authenticated
using (
  (select private.app_is_admin())
  or (
    user_id = (select auth.uid())
    and active
  )
);

create policy manager_permissions_select_access
on public.manager_permissions
for select
to authenticated
using (
  (select private.app_is_admin())
  or (
    user_id = (select auth.uid())
    and (select private.app_user_location_id()) is not null
  )
);

create policy audit_events_select_access
on public.audit_events
for select
to authenticated
using (
  (select private.app_is_admin())
  or (
    location_id is not null
    and location_id = (select private.app_user_location_id())
  )
);
