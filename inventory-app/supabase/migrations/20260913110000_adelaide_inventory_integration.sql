-- Adelaide Wholesale Tyres integration boundary.
--
-- This migration intentionally extends the existing ledger rather than adding a
-- second stock source.  Every external reservation changes `reserved`; every
-- external sale posts an append-only `stock_out` movement and changes `on_hand`.

-- System actor metadata. Extends (never narrows) the finance-phase actor roles. -------------------------------------------------------

alter table public.audit_events
  drop constraint if exists audit_events_actor_role_check;
alter table public.audit_events
  add constraint audit_events_actor_role_check
  check (actor_role in ('admin', 'manager', 'system', 'integration'));

alter table public.audit_events
  add column if not exists actor_type text not null default 'human'
  check (actor_type in ('human', 'integration')),
  add column if not exists integration_client_id text;

alter table public.inventory_movements
  alter column actor_user_id drop not null,
  add column if not exists actor_type text not null default 'human'
  check (actor_type in ('human', 'integration')),
  add column if not exists integration_client_id text,
  add column if not exists external_reservation_id uuid;

create index if not exists inventory_movements_integration_reservation_idx
  on public.inventory_movements (integration_client_id, external_reservation_id)
  where actor_type = 'integration';

-- Exactly one sale movement per (reservation, product): the advisory lock and
-- status transition already prevent a double commit; this makes it a hard
-- database invariant that reconciliation can rely on.
create unique index if not exists inventory_movements_external_reservation_product_key
  on public.inventory_movements (external_reservation_id, product_id)
  where external_reservation_id is not null;

-- Permanent one-to-one mapping ------------------------------------------------

create table public.adelaide_product_mappings (
  id uuid primary key,
  website_product_id text not null unique,
  inventory_product_id uuid not null unique references public.products(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint adelaide_product_mappings_website_product_not_blank check (btrim(website_product_id) <> '')
);

alter table public.adelaide_product_mappings enable row level security;
revoke all on public.adelaide_product_mappings from public, anon, authenticated, service_role;
grant select on public.adelaide_product_mappings to service_role;

create or replace function public.upsert_adelaide_product_mapping(
  p_mapping_id uuid,
  p_website_product_id text,
  p_inventory_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_mapping_id is null or nullif(btrim(p_website_product_id), '') is null or p_inventory_product_id is null then
    raise exception 'INVALID_MAPPING' using errcode = '22023';
  end if;
  insert into public.adelaide_product_mappings(id, website_product_id, inventory_product_id)
  values (p_mapping_id, btrim(p_website_product_id), p_inventory_product_id)
  on conflict (website_product_id) do update set inventory_product_id = excluded.inventory_product_id
  where public.adelaide_product_mappings.id = excluded.id;
  if not found then raise exception 'MAPPING_CONFLICT' using errcode = '23505'; end if;
end;
$$;

-- The mapping IDs are stable across environments. Product UUIDs remain private
-- to 247 and are resolved only inside the integration RPCs.
with expected(website_product_id, brand, pattern, size) as (
  values
    ('ralson-rdr75-26570r195', 'RALSON', 'RDR75', '265/70R19.5'),
    ('ralson-rmr61-26570r195', 'RALSON', 'RMR61', '265/70R19.5'),
    ('ralson-rmr61-29580r225', 'RALSON', 'RMR61', '295/80R22.5'),
    ('ralson-rdr75-29580r225', 'RALSON', 'RDR75', '295/80R22.5'),
    ('ralson-rmr61-38565r225', 'RALSON', 'RMR61', '385/65R22.5'),
    ('ralson-rtr71-11r225', 'RALSON', 'RTR71', '11R22.5'),
    ('ralson-rdr52-11r225', 'RALSON', 'RDR52', '11R22.5'),
    ('ralson-rdr55-11r225', 'RALSON', 'RDR55', '11R22.5'),
    ('ralson-rdc66-11r225', 'RALSON', 'RDC66', '11R22.5'),
    ('ralson-rac55-11r225', 'RALSON', 'RAC55', '11R22.5'),
    ('ralson-rdr75-23575r175', 'RALSON', 'RDR75', '235/75R17.5'),
    ('ralson-rmr61-23575r175', 'RALSON', 'RMR61', '235/75R17.5'),
    ('ralson-rmr61-27570r225', 'RALSON', 'RMR61', '275/70R22.5'),
    ('greforce-hd02-11r225', 'GREFORCE', 'HD02', '11R22.5'),
    ('greforce-gr881w-11r225', 'GREFORCE', 'GR881W', '11R22.5'),
    ('greforce-grd1919-11r225', 'GREFORCE', 'GRD1919', '11R22.5'),
    ('greforce-grt33-95r175', 'GREFORCE', 'GRT33', '9.5R17.5'),
    ('greforce-grt33-23575r175', 'GREFORCE', 'GRT33', '235/75R17.5'),
    ('jumbo-ss398-29580r225', 'JUMBO', 'SS398', '295/80R22.5'),
    ('opartner-cp989-26570r195', 'OPARTNER', 'CP989', '265/70R19.5'),
    ('haulmax-att101-11r225', 'HAULMAX', 'ATT101', '11R22.5'),
    ('haulmax-att101-27570r225', 'HAULMAX', 'ATT101', '275/70R22.5'),
    ('haulmax-att420-29580r225', 'HAULMAX', 'ATT420', '295/80R22.5'),
    ('sailun-sfr22-38565r225', 'SAILUN', 'SFR22', '385/65R22.5')
), candidates as (
  select
    e.website_product_id,
    p.id as inventory_product_id,
    count(*) over (partition by e.website_product_id) as match_count
  from expected e
  join public.products p on p.category_code = 'truck_tyre' and p.tyre_condition = 'new'
  join public.tyre_brands b on b.id = p.tyre_brand_id
  join public.tyre_patterns pat on pat.id = p.tyre_pattern_id
  join public.tyre_sizes s on s.id = p.tyre_size_id
  where b.normalized_name = e.brand
    and pat.normalized_name = e.pattern
    and s.normalized_size = e.size
)
insert into public.adelaide_product_mappings (id, website_product_id, inventory_product_id)
select
  pg_catalog.md5('adelaide-wholesale-tyres:' || website_product_id)::uuid,
  website_product_id,
  inventory_product_id
from candidates
where match_count = 1
on conflict (website_product_id) do nothing;

-- External reservation state --------------------------------------------------

create table public.adelaide_inventory_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id text not null,
  external_order_reference text not null,
  request_id uuid not null,
  request_hash text not null,
  location_id uuid not null references public.locations(id),
  status text not null default 'active'
    check (status in ('active', 'committed', 'released', 'expired')),
  expires_at timestamptz not null,
  commit_request_id uuid unique,
  commit_request_hash text,
  committed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, request_id),
  constraint adelaide_inventory_reservations_reference_not_blank check (btrim(external_order_reference) <> ''),
  constraint adelaide_inventory_reservations_commit_shape check (
    (status = 'committed' and committed_at is not null and commit_request_id is not null)
    or status <> 'committed'
  )
);

create table public.adelaide_inventory_reservation_lines (
  reservation_id uuid not null references public.adelaide_inventory_reservations(id) on delete restrict,
  mapping_id uuid not null references public.adelaide_product_mappings(id) on delete restrict,
  inventory_product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  primary key (reservation_id, mapping_id)
);

create index adelaide_inventory_reservations_active_expiry_idx
  on public.adelaide_inventory_reservations (expires_at)
  where status = 'active';
create index adelaide_inventory_reservation_lines_product_idx
  on public.adelaide_inventory_reservation_lines (inventory_product_id);

alter table public.adelaide_inventory_reservations enable row level security;
alter table public.adelaide_inventory_reservation_lines enable row level security;
revoke all on public.adelaide_inventory_reservations, public.adelaide_inventory_reservation_lines
  from public, anon, authenticated, service_role;
grant select on public.adelaide_inventory_reservations, public.adelaide_inventory_reservation_lines to service_role;

create or replace function private.adelaide_audit(
  p_event_type text,
  p_entity_type text,
  p_entity_id text,
  p_location_id uuid,
  p_client_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    actor_user_id, actor_role, actor_type, integration_client_id,
    location_id, event_type, entity_type, entity_id, details
  ) values (
    null, 'integration', 'integration', p_client_id,
    p_location_id, p_event_type, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function private.release_adelaide_reservation(
  p_reservation_id uuid,
  p_reason text,
  p_expired boolean default false
)
returns public.adelaide_inventory_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.adelaide_inventory_reservations%rowtype;
  v_line record;
begin
  select * into v_reservation
  from public.adelaide_inventory_reservations
  where id = p_reservation_id
  for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_reservation.status <> 'active' then
    return v_reservation;
  end if;

  for v_line in
    select * from public.adelaide_inventory_reservation_lines
    where reservation_id = v_reservation.id
    order by inventory_product_id
  loop
    update public.inventory_balances
    set reserved = reserved - v_line.quantity, updated_at = now()
    where product_id = v_line.inventory_product_id
      and location_id = v_reservation.location_id
      and reserved >= v_line.quantity;
    if not found then
      raise exception 'RESERVATION_INCONSISTENT' using errcode = '23514';
    end if;
  end loop;

  update public.adelaide_inventory_reservations
  set status = case when p_expired then 'expired' else 'released' end,
      released_at = now(), release_reason = left(coalesce(p_reason, ''), 500), updated_at = now()
  where id = v_reservation.id
  returning * into v_reservation;

  perform private.adelaide_audit(
    case when p_expired then 'ADELAIDE_RESERVATION_EXPIRED' else 'ADELAIDE_RESERVATION_RELEASED' end,
    'adelaide_inventory_reservation', v_reservation.id::text, v_reservation.location_id,
    v_reservation.client_id,
    jsonb_build_object('order_reference', v_reservation.external_order_reference, 'reason', p_reason)
  );
  return v_reservation;
end;
$$;

create or replace function public.expire_adelaide_inventory_reservations(
  p_client_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation record;
  v_count integer := 0;
begin
  for v_reservation in
    select id
    from public.adelaide_inventory_reservations
    where status = 'active'
      and expires_at <= now()
      and (p_client_id is null or client_id = p_client_id)
    order by id
    for update skip locked
  loop
    perform private.release_adelaide_reservation(v_reservation.id, 'checkout_hold_expired', true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.adelaide_inventory_availability(
  p_client_id text,
  p_location_id uuid,
  p_mapping_ids uuid[]
)
returns table (
  mapping_id uuid,
  inventory_product_id uuid,
  on_hand integer,
  reserved integer,
  available integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_client_id is null or btrim(p_client_id) = '' or p_location_id is null then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  perform public.expire_adelaide_inventory_reservations(p_client_id);
  return query
  select m.id, m.inventory_product_id, b.on_hand, b.reserved,
    b.on_hand - b.reserved, b.updated_at
  from public.adelaide_product_mappings m
  join public.inventory_balances b on b.product_id = m.inventory_product_id
  join public.products p on p.id = m.inventory_product_id
  where m.id = any(p_mapping_ids)
    and b.location_id = p_location_id
    and p.active;
end;
$$;

create or replace function public.reserve_adelaide_inventory(
  p_client_id text,
  p_request_id uuid,
  p_request_hash text,
  p_order_reference text,
  p_location_id uuid,
  p_expires_at timestamptz,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.adelaide_inventory_reservations%rowtype;
  v_reservation_id uuid := extensions.gen_random_uuid();
  v_line record;
  v_count integer;
  v_locked integer := 0;
begin
  if p_client_id is null or btrim(p_client_id) = '' or p_request_id is null
    or p_request_hash is null or btrim(p_request_hash) = '' or p_location_id is null
    or nullif(btrim(p_order_reference), '') is null then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '2 hours' then
    raise exception 'INVALID_RESERVATION_EXPIRY' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 25 then
    raise exception 'INVALID_RESERVATION_LINES' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'adelaide-reservation:' || p_client_id || ':' || p_request_id::text, 0
  ));
  perform public.expire_adelaide_inventory_reservations(p_client_id);

  select * into v_existing
  from public.adelaide_inventory_reservations
  where client_id = p_client_id and request_id = p_request_id;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'reservation_id', v_existing.id, 'status', v_existing.status,
      'expires_at', v_existing.expires_at, 'order_reference', v_existing.external_order_reference
    );
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) x(value)
    where jsonb_typeof(x.value) <> 'object'
      or not (x.value ? 'mapping_id' and x.value ? 'quantity')
      or (x.value->>'mapping_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (x.value->>'quantity') !~ '^[1-9][0-9]*$'
      or (x.value->>'quantity')::numeric > 1000
  ) then
    raise exception 'INVALID_RESERVATION_LINES' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) x(value)
    group by (x.value->>'mapping_id') having count(*) > 1
  ) then
    raise exception 'DUPLICATE_RESERVATION_PRODUCT' using errcode = '22023';
  end if;

  select count(*) into v_count
  from jsonb_to_recordset(p_lines) as i(mapping_id uuid, quantity integer);
  if v_count <> jsonb_array_length(p_lines) then
    raise exception 'INVALID_RESERVATION_LINES' using errcode = '22023';
  end if;

  -- Every requested line must resolve to a permanent mapping, an active product
  -- and a balance row at the sellable location before any row is locked. An
  -- unmapped or inactive tyre can never hold (or later deduct) another tyre.
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as i(mapping_id uuid, quantity integer)
    where not exists (select 1 from public.adelaide_product_mappings m where m.id = i.mapping_id)
  ) then
    raise exception 'UNKNOWN_PRODUCT_MAPPING' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as i(mapping_id uuid, quantity integer)
    join public.adelaide_product_mappings m on m.id = i.mapping_id
    join public.products p on p.id = m.inventory_product_id
    where not p.active
  ) then
    raise exception 'PRODUCT_INACTIVE' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as i(mapping_id uuid, quantity integer)
    join public.adelaide_product_mappings m on m.id = i.mapping_id
    where not exists (
      select 1 from public.inventory_balances b
      where b.product_id = m.inventory_product_id and b.location_id = p_location_id
    )
  ) then
    -- No balance row at this location means nothing sellable there.
    raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
  end if;

  -- Lock every target balance in a stable product order before changing any row.
  for v_line in
    select i.mapping_id, i.quantity, m.inventory_product_id, b.on_hand, b.reserved
    from jsonb_to_recordset(p_lines) as i(mapping_id uuid, quantity integer)
    join public.adelaide_product_mappings m on m.id = i.mapping_id
    join public.products p on p.id = m.inventory_product_id and p.active
    join public.inventory_balances b on b.product_id = m.inventory_product_id and b.location_id = p_location_id
    order by m.inventory_product_id
    for update of b
  loop
    v_locked := v_locked + 1;
    if v_line.on_hand - v_line.reserved < v_line.quantity then
      raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
    end if;
  end loop;
  if v_locked <> v_count then
    raise exception 'UNKNOWN_PRODUCT_MAPPING' using errcode = 'P0002';
  end if;

  insert into public.adelaide_inventory_reservations(
    id, client_id, external_order_reference, request_id, request_hash, location_id, expires_at
  ) values (
    v_reservation_id, p_client_id, btrim(p_order_reference), p_request_id, p_request_hash, p_location_id, p_expires_at
  );
  insert into public.adelaide_inventory_reservation_lines(reservation_id, mapping_id, inventory_product_id, quantity)
  select v_reservation_id, i.mapping_id, m.inventory_product_id, i.quantity
  from jsonb_to_recordset(p_lines) as i(mapping_id uuid, quantity integer)
  join public.adelaide_product_mappings m on m.id = i.mapping_id;
  update public.inventory_balances b
  set reserved = b.reserved + l.quantity, updated_at = now()
  from public.adelaide_inventory_reservation_lines l
  where l.reservation_id = v_reservation_id
    and b.product_id = l.inventory_product_id and b.location_id = p_location_id;

  perform private.adelaide_audit(
    'ADELAIDE_RESERVATION_CREATED', 'adelaide_inventory_reservation', v_reservation_id::text,
    p_location_id, p_client_id,
    jsonb_build_object('order_reference', p_order_reference, 'request_id', p_request_id, 'expires_at', p_expires_at)
  );
  return jsonb_build_object('reservation_id', v_reservation_id, 'status', 'active', 'expires_at', p_expires_at, 'order_reference', btrim(p_order_reference));
end;
$$;

create or replace function public.release_adelaide_inventory_reservation(
  p_client_id text,
  p_reservation_id uuid,
  p_request_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype;
begin
  if p_client_id is null or p_reservation_id is null or p_request_id is null then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'adelaide-release:' || p_client_id || ':' || p_reservation_id::text || ':' || p_request_id::text, 0
  ));
  select * into v_reservation from public.adelaide_inventory_reservations
  where id = p_reservation_id and client_id = p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002'; end if;
  v_reservation := private.release_adelaide_reservation(v_reservation.id, left(coalesce(p_reason, 'released'), 500), false);
  return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status, 'order_reference', v_reservation.external_order_reference);
end;
$$;

create or replace function public.commit_adelaide_inventory_sale(
  p_client_id text,
  p_reservation_id uuid,
  p_request_id uuid,
  p_request_hash text,
  p_order_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.adelaide_inventory_reservations%rowtype;
  v_line record;
begin
  if p_client_id is null or p_reservation_id is null or p_request_id is null
    or p_request_hash is null or btrim(p_request_hash) = ''
    or p_order_reference is null or btrim(p_order_reference) = '' then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'adelaide-commit:' || p_client_id || ':' || p_reservation_id::text, 0
  ));
  select * into v_reservation from public.adelaide_inventory_reservations
  where id = p_reservation_id and client_id = p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_reservation.external_order_reference <> p_order_reference then
    raise exception 'ORDER_REFERENCE_MISMATCH' using errcode = '22023';
  end if;
  if v_reservation.status = 'committed' then
    if v_reservation.commit_request_id <> p_request_id or v_reservation.commit_request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object('reservation_id', v_reservation.id, 'status', 'committed', 'order_reference', v_reservation.external_order_reference, 'committed_at', v_reservation.committed_at);
  end if;
  if v_reservation.status <> 'active' then
    raise exception 'RESERVATION_NOT_ACTIVE' using errcode = '23514';
  end if;
  if v_reservation.expires_at <= now() then
    -- Expire the hold durably. Raising here would roll the release back, so the
    -- refusal is expressed in the result and mapped to RESERVATION_EXPIRED by
    -- the service layer.
    v_reservation := private.release_adelaide_reservation(v_reservation.id, 'checkout_hold_expired', true);
    return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status, 'order_reference', v_reservation.external_order_reference);
  end if;

  for v_line in
    select * from public.adelaide_inventory_reservation_lines
    where reservation_id = v_reservation.id order by inventory_product_id
  loop
    update public.inventory_balances
    set reserved = reserved - v_line.quantity,
        on_hand = on_hand - v_line.quantity,
        updated_at = now()
    where product_id = v_line.inventory_product_id
      and location_id = v_reservation.location_id
      and reserved >= v_line.quantity
      and on_hand >= v_line.quantity;
    if not found then raise exception 'RESERVATION_INCONSISTENT' using errcode = '23514'; end if;

    insert into public.inventory_movements(
      request_id, product_id, location_id, quantity_delta, movement_type, reason,
      source_type, source_id, cost_snapshot, actor_user_id, actor_type,
      integration_client_id, external_reservation_id
    ) values (
      pg_catalog.md5('adelaide-sale:' || v_reservation.id::text || ':' || v_line.inventory_product_id::text)::uuid,
      v_line.inventory_product_id, v_reservation.location_id, -v_line.quantity,
      'stock_out', 'Adelaide Wholesale Tyres sale ' || v_reservation.external_order_reference,
      'adelaide_wholesale_tyres', v_reservation.external_order_reference,
      (select weighted_average_cost from public.inventory_balances where product_id = v_line.inventory_product_id and location_id = v_reservation.location_id),
      null, 'integration', p_client_id, v_reservation.id
    );
  end loop;

  update public.adelaide_inventory_reservations
  set status = 'committed', commit_request_id = p_request_id, commit_request_hash = p_request_hash,
      committed_at = now(), updated_at = now()
  where id = v_reservation.id
  returning * into v_reservation;
  perform private.adelaide_audit(
    'ADELAIDE_SALE_COMMITTED', 'adelaide_inventory_reservation', v_reservation.id::text,
    v_reservation.location_id, p_client_id,
    jsonb_build_object('order_reference', v_reservation.external_order_reference, 'request_id', p_request_id)
  );
  return jsonb_build_object('reservation_id', v_reservation.id, 'status', 'committed', 'order_reference', v_reservation.external_order_reference, 'committed_at', v_reservation.committed_at);
end;
$$;

create or replace function public.adelaide_inventory_reservation_status(
  p_client_id text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype;
begin
  perform public.expire_adelaide_inventory_reservations(p_client_id);
  select * into v_reservation from public.adelaide_inventory_reservations
  where id = p_reservation_id and client_id = p_client_id;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status,
    'order_reference', v_reservation.external_order_reference, 'expires_at', v_reservation.expires_at,
    'committed_at', v_reservation.committed_at, 'released_at', v_reservation.released_at);
end;
$$;

-- Database RPCs are reachable only through the server-only service-role client
-- after the HMAC route boundary has authenticated the caller.
revoke execute on function public.expire_adelaide_inventory_reservations(text),
  public.upsert_adelaide_product_mapping(uuid, text, uuid),
  public.adelaide_inventory_availability(text, uuid, uuid[]),
  public.reserve_adelaide_inventory(text, uuid, text, text, uuid, timestamptz, jsonb),
  public.release_adelaide_inventory_reservation(text, uuid, uuid, text),
  public.commit_adelaide_inventory_sale(text, uuid, uuid, text, text),
  public.adelaide_inventory_reservation_status(text, uuid)
  from public, anon, authenticated;
grant execute on function public.expire_adelaide_inventory_reservations(text),
  public.upsert_adelaide_product_mapping(uuid, text, uuid),
  public.adelaide_inventory_availability(text, uuid, uuid[]),
  public.reserve_adelaide_inventory(text, uuid, text, text, uuid, timestamptz, jsonb),
  public.release_adelaide_inventory_reservation(text, uuid, uuid, text),
  public.commit_adelaide_inventory_sale(text, uuid, uuid, text, text),
  public.adelaide_inventory_reservation_status(text, uuid)
  to service_role;

revoke execute on function private.adelaide_audit(text, text, text, uuid, text, jsonb),
  private.release_adelaide_reservation(uuid, text, boolean)
  from public, anon, authenticated, service_role;
