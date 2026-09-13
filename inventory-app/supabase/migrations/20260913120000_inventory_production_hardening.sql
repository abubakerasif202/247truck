-- Production hardening for the Adelaide website inventory boundary.
-- Forward-only: preserves reservation, movement, audit and financial history.

alter table public.adelaide_inventory_reservations
  add column paid_protected_at timestamptz,
  add column release_request_id uuid,
  add column release_request_hash text;

create unique index adelaide_reservations_release_request_key
  on public.adelaide_inventory_reservations (client_id, release_request_id)
  where release_request_id is not null;

create table public.adelaide_website_products (
  website_product_id text primary key,
  expected_mapping_id uuid not null unique,
  brand text not null,
  pattern text not null,
  tyre_size text not null,
  tyre_condition text not null default 'new' check (tyre_condition in ('new', 'used')),
  intended_location_id uuid not null references public.locations(id) on delete restrict,
  active boolean not null default true,
  sellable boolean not null default true,
  catalogue_version text not null,
  updated_at timestamptz not null default now(),
  check (btrim(website_product_id) <> ''),
  check (btrim(brand) <> '' and btrim(pattern) <> '' and btrim(tyre_size) <> ''),
  check (btrim(catalogue_version) <> '')
);
create index adelaide_website_products_location_idx on public.adelaide_website_products(intended_location_id);
alter table public.adelaide_website_products enable row level security;
revoke all on public.adelaide_website_products from public, anon, authenticated, service_role;
grant select on public.adelaide_website_products to service_role;

insert into public.adelaide_website_products(
  website_product_id, expected_mapping_id, brand, pattern, tyre_size, tyre_condition,
  intended_location_id, catalogue_version
)
select m.website_product_id, m.id, b.normalized_name, pat.normalized_name, s.normalized_size,
  p.tyre_condition, l.id, 'inventory-contract-2026-09-13'
from public.adelaide_product_mappings m
join public.products p on p.id=m.inventory_product_id
join public.tyre_brands b on b.id=p.tyre_brand_id
join public.tyre_patterns pat on pat.id=p.tyre_pattern_id
join public.tyre_sizes s on s.id=p.tyre_size_id
join public.locations l on l.code='REG'
on conflict (website_product_id) do nothing;

with expected(website_product_id,brand,pattern,tyre_size) as (values
  ('ralson-rdr75-26570r195','RALSON','RDR75','265/70R19.5'),
  ('ralson-rmr61-26570r195','RALSON','RMR61','265/70R19.5'),
  ('ralson-rmr61-29580r225','RALSON','RMR61','295/80R22.5'),
  ('ralson-rdr75-29580r225','RALSON','RDR75','295/80R22.5'),
  ('ralson-rmr61-38565r225','RALSON','RMR61','385/65R22.5'),
  ('ralson-rtr71-11r225','RALSON','RTR71','11R22.5'),
  ('ralson-rdr52-11r225','RALSON','RDR52','11R22.5'),
  ('ralson-rdr55-11r225','RALSON','RDR55','11R22.5'),
  ('ralson-rdc66-11r225','RALSON','RDC66','11R22.5'),
  ('ralson-rac55-11r225','RALSON','RAC55','11R22.5'),
  ('ralson-rdr75-23575r175','RALSON','RDR75','235/75R17.5'),
  ('ralson-rmr61-23575r175','RALSON','RMR61','235/75R17.5'),
  ('ralson-rmr61-27570r225','RALSON','RMR61','275/70R22.5'),
  ('greforce-hd02-11r225','GREFORCE','HD02','11R22.5'),
  ('greforce-gr881w-11r225','GREFORCE','GR881W','11R22.5'),
  ('greforce-grd1919-11r225','GREFORCE','GRD1919','11R22.5'),
  ('greforce-grt33-95r175','GREFORCE','GRT33','9.5R17.5'),
  ('greforce-grt33-23575r175','GREFORCE','GRT33','235/75R17.5'),
  ('jumbo-ss398-29580r225','JUMBO','SS398','295/80R22.5'),
  ('opartner-cp989-26570r195','OPARTNER','CP989','265/70R19.5'),
  ('haulmax-att101-11r225','HAULMAX','ATT101','11R22.5'),
  ('haulmax-att101-27570r225','HAULMAX','ATT101','275/70R22.5'),
  ('haulmax-att420-29580r225','HAULMAX','ATT420','295/80R22.5'),
  ('sailun-sfr22-38565r225','SAILUN','SFR22','385/65R22.5')
)
insert into public.adelaide_website_products(website_product_id,expected_mapping_id,brand,pattern,tyre_size,
  tyre_condition,intended_location_id,catalogue_version)
select e.website_product_id,pg_catalog.md5('adelaide-wholesale-tyres:'||e.website_product_id)::uuid,
  e.brand,e.pattern,e.tyre_size,'new',l.id,'inventory-contract-2026-09-13'
from expected e cross join public.locations l where l.code='REG'
on conflict (website_product_id) do nothing;

-- This sellable website tyre is intentionally registered even though no safe,
-- unique inventory match existed in the source migration. It must remain a
-- visible production blocker rather than being silently omitted.
insert into public.adelaide_website_products(
  website_product_id, expected_mapping_id, brand, pattern, tyre_size, tyre_condition,
  intended_location_id, catalogue_version
)
select 'greforce-g-pilot-x1-29580r225',
  pg_catalog.md5('adelaide-wholesale-tyres:greforce-g-pilot-x1-29580r225')::uuid,
  'GREFORCE','G-PILOT X1','295/80R22.5','new',id,'inventory-contract-2026-09-13'
from public.locations where code='REG'
on conflict (website_product_id) do nothing;

-- Inventory-side durable mirror/outbox. The website remains responsible for
-- transactionally writing its own paid-order outbox before calling this API.
create table public.adelaide_order_inventory_commits (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id text not null,
  external_order_reference text not null,
  reservation_id uuid not null references public.adelaide_inventory_reservations(id) on delete restrict,
  payment_status text not null check (payment_status in ('pending', 'paid', 'cancelled', 'refunded', 'disputed')),
  order_status text not null check (order_status in ('pending', 'confirmed', 'cancelled', 'refunded', 'manual_review')),
  inventory_state text not null check (inventory_state in (
    'reservation_pending', 'reserved', 'payment_pending', 'commit_pending',
    'committed', 'release_pending', 'released', 'manual_review'
  )),
  state_request_id uuid not null,
  state_request_hash text not null,
  commit_request_id uuid not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  last_error_code text,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, external_order_reference),
  unique (client_id, reservation_id),
  unique (client_id, state_request_id),
  unique (client_id, commit_request_id),
  check (btrim(external_order_reference) <> ''),
  check (state_request_hash ~ '^[0-9a-f]{64}$'),
  check ((inventory_state = 'committed' and committed_at is not null) or inventory_state <> 'committed'),
  check ((payment_status = 'paid' and inventory_state not in ('release_pending', 'released')) or payment_status <> 'paid')
);
create index adelaide_commit_queue_due_idx
  on public.adelaide_order_inventory_commits(next_retry_at, created_at, id)
  where inventory_state = 'commit_pending';
alter table public.adelaide_order_inventory_commits enable row level security;
revoke all on public.adelaide_order_inventory_commits from public, anon, authenticated, service_role;
grant select on public.adelaide_order_inventory_commits to service_role;

create table public.adelaide_integration_requests (
  client_id text not null,
  request_id uuid not null,
  method text not null,
  pathname text not null,
  body_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  delivery_count integer not null default 1 check (delivery_count > 0),
  primary key (client_id, request_id),
  check (method in ('GET', 'POST', 'DELETE')),
  check (body_hash ~ '^[0-9a-f]{64}$')
);
create index adelaide_integration_requests_seen_idx on public.adelaide_integration_requests(client_id, first_seen_at);
alter table public.adelaide_integration_requests enable row level security;
revoke all on public.adelaide_integration_requests from public, anon, authenticated, service_role;

create table public.adelaide_operation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  operation text not null check (operation in ('expiry', 'commit_retry', 'reconciliation')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now()
);
create index adelaide_operation_runs_recent_idx on public.adelaide_operation_runs(operation, started_at desc);
alter table public.adelaide_operation_runs enable row level security;
revoke all on public.adelaide_operation_runs from public, anon, authenticated, service_role;
grant select on public.adelaide_operation_runs to service_role;

create table public.manager_invitation_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  email_hash text not null,
  auth_user_id uuid,
  requested_by uuid not null references auth.users(id) on delete restrict,
  desired_profile jsonb not null,
  status text not null check (status in ('pending_auth', 'auth_invited', 'completed', 'compensation_pending', 'compensated', 'manual_review')),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index manager_invitation_open_email_key on public.manager_invitation_operations(email_hash)
  where status in ('pending_auth', 'auth_invited', 'compensation_pending', 'manual_review');
alter table public.manager_invitation_operations enable row level security;
revoke all on public.manager_invitation_operations from public, anon, authenticated, service_role;
grant select, insert, update on public.manager_invitation_operations to service_role;
grant select on public.manager_invitation_operations to authenticated;
create policy manager_invitation_operations_admin_read on public.manager_invitation_operations
  for select to authenticated using (
    exists(select 1 from public.user_profiles p where p.user_id=(select auth.uid()) and p.role='admin' and p.active)
  );

create or replace function private.require_active_admin()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not exists (
    select 1 from public.user_profiles where user_id = v_actor and role = 'admin' and active
  ) then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  return v_actor;
end;
$$;
revoke execute on function private.require_active_admin() from public, anon, authenticated, service_role;

create or replace function public.record_adelaide_integration_request(
  p_client_id text, p_request_id uuid, p_method text, p_pathname text, p_body_hash text
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_existing public.adelaide_integration_requests%rowtype; v_count integer;
begin
  if nullif(btrim(p_client_id), '') is null or p_request_id is null
     or upper(p_method) not in ('GET','POST','DELETE') or p_pathname !~ '^/api/integrations/adelaide/'
     or p_body_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-request:' || p_client_id || ':' || p_request_id::text, 0));
  select * into v_existing from public.adelaide_integration_requests
   where client_id = p_client_id and request_id = p_request_id for update;
  if found then
    if v_existing.method <> upper(p_method) or v_existing.pathname <> p_pathname or v_existing.body_hash <> p_body_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    update public.adelaide_integration_requests set last_seen_at = now(), delivery_count = delivery_count + 1
     where client_id = p_client_id and request_id = p_request_id returning delivery_count into v_count;
    return v_count;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-rate:' || p_client_id, 0));
  select count(*) into v_count from public.adelaide_integration_requests
   where client_id = p_client_id and first_seen_at >= now() - interval '1 minute';
  if v_count >= 120 then raise exception 'RATE_LIMITED' using errcode = '57014'; end if;
  insert into public.adelaide_integration_requests(client_id, request_id, method, pathname, body_hash)
  values (p_client_id, p_request_id, upper(p_method), p_pathname, p_body_hash);
  return 1;
end;
$$;

create or replace function public.release_adelaide_inventory_reservation(
  p_client_id text, p_reservation_id uuid, p_request_id uuid, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype; v_hash text;
begin
  if nullif(btrim(p_client_id), '') is null or p_reservation_id is null or p_request_id is null then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  v_hash := encode(extensions.digest(convert_to(coalesce(btrim(p_reason), ''), 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-reservation:' || p_reservation_id::text, 0));
  select * into v_reservation from public.adelaide_inventory_reservations
   where id = p_reservation_id and client_id = p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_reservation.release_request_id is not null then
    if v_reservation.release_request_id = p_request_id and v_reservation.release_request_hash <> v_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    if v_reservation.status in ('released','expired','committed') then
      return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status,
        'order_reference', v_reservation.external_order_reference);
    end if;
  end if;
  if v_reservation.status = 'committed' then
    return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status,
      'order_reference', v_reservation.external_order_reference);
  end if;
  if v_reservation.paid_protected_at is not null or exists (
    select 1 from public.adelaide_order_inventory_commits o where o.reservation_id = v_reservation.id and o.payment_status = 'paid'
  ) then raise exception 'PAID_ORDER_RELEASE_FORBIDDEN' using errcode = '23514'; end if;
  update public.adelaide_inventory_reservations set release_request_id = p_request_id, release_request_hash = v_hash
   where id = v_reservation.id;
  v_reservation := private.release_adelaide_reservation(v_reservation.id, left(coalesce(p_reason, 'released'), 500), false);
  return jsonb_build_object('reservation_id', v_reservation.id, 'status', v_reservation.status,
    'order_reference', v_reservation.external_order_reference);
end;
$$;

create or replace function public.expire_adelaide_inventory_reservations(p_client_id text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_reservation record; v_count integer := 0;
begin
  for v_reservation in
    select r.id from public.adelaide_inventory_reservations r
    where r.status = 'active' and r.expires_at <= now() and r.paid_protected_at is null
      and (p_client_id is null or r.client_id = p_client_id)
      and not exists (select 1 from public.adelaide_order_inventory_commits o where o.reservation_id = r.id and o.payment_status = 'paid')
    order by r.id for update of r skip locked
  loop
    perform private.release_adelaide_reservation(v_reservation.id, 'checkout_hold_expired', true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.commit_adelaide_inventory_sale(
  p_client_id text, p_reservation_id uuid, p_request_id uuid, p_request_hash text, p_order_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype; v_line record;
begin
  if nullif(btrim(p_client_id), '') is null or p_reservation_id is null or p_request_id is null
    or p_request_hash !~ '^[0-9a-f]{64}$' or nullif(btrim(p_order_reference), '') is null then
    raise exception 'INVALID_INTEGRATION_REQUEST' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-reservation:' || p_reservation_id::text, 0));
  select * into v_reservation from public.adelaide_inventory_reservations
   where id=p_reservation_id and client_id=p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_reservation.external_order_reference<>btrim(p_order_reference) then raise exception 'ORDER_REFERENCE_MISMATCH' using errcode='22023'; end if;
  if v_reservation.status='committed' then
    if v_reservation.commit_request_id<>p_request_id or v_reservation.commit_request_hash<>p_request_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
    return jsonb_build_object('reservation_id',v_reservation.id,'status','committed','order_reference',v_reservation.external_order_reference,'committed_at',v_reservation.committed_at);
  end if;
  if v_reservation.status<>'active' then raise exception 'RESERVATION_NOT_ACTIVE' using errcode='23514'; end if;
  if v_reservation.expires_at<=now() and v_reservation.paid_protected_at is null then
    v_reservation:=private.release_adelaide_reservation(v_reservation.id,'checkout_hold_expired',true);
    return jsonb_build_object('reservation_id',v_reservation.id,'status',v_reservation.status,'order_reference',v_reservation.external_order_reference);
  end if;
  -- Balance rows are locked in the same product order used by reserve/release.
  for v_line in select * from public.adelaide_inventory_reservation_lines
    where reservation_id=v_reservation.id order by inventory_product_id
  loop
    update public.inventory_balances set reserved=reserved-v_line.quantity,on_hand=on_hand-v_line.quantity,updated_at=now()
     where product_id=v_line.inventory_product_id and location_id=v_reservation.location_id
       and reserved>=v_line.quantity and on_hand>=v_line.quantity;
    if not found then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    insert into public.inventory_movements(request_id,product_id,location_id,quantity_delta,movement_type,reason,
      source_type,source_id,cost_snapshot,actor_user_id,actor_type,integration_client_id,external_reservation_id)
    values(pg_catalog.md5('adelaide-sale:'||v_reservation.id::text||':'||v_line.inventory_product_id::text)::uuid,
      v_line.inventory_product_id,v_reservation.location_id,-v_line.quantity,'stock_out',
      'Adelaide Wholesale Tyres sale '||v_reservation.external_order_reference,'adelaide_wholesale_tyres',
      v_reservation.external_order_reference,(select weighted_average_cost from public.inventory_balances
       where product_id=v_line.inventory_product_id and location_id=v_reservation.location_id),
      null,'integration',p_client_id,v_reservation.id);
  end loop;
  update public.adelaide_inventory_reservations set status='committed',commit_request_id=p_request_id,
    commit_request_hash=p_request_hash,committed_at=now(),updated_at=now() where id=v_reservation.id returning * into v_reservation;
  perform private.adelaide_audit('ADELAIDE_SALE_COMMITTED','adelaide_inventory_reservation',v_reservation.id::text,
    v_reservation.location_id,p_client_id,jsonb_build_object('order_reference',v_reservation.external_order_reference,'request_id',p_request_id));
  return jsonb_build_object('reservation_id',v_reservation.id,'status','committed','order_reference',v_reservation.external_order_reference,'committed_at',v_reservation.committed_at);
end;
$$;

create or replace function public.register_adelaide_order_state(
  p_client_id text, p_request_id uuid, p_request_hash text, p_reservation_id uuid,
  p_order_reference text, p_payment_status text, p_order_status text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_reservation public.adelaide_inventory_reservations%rowtype; v_existing public.adelaide_order_inventory_commits%rowtype;
  v_state text; v_commit_request_id uuid;
begin
  if p_payment_status not in ('pending','paid','cancelled','refunded','disputed')
    or p_order_status not in ('pending','confirmed','cancelled','refunded','manual_review')
    or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_ORDER_STATE' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adelaide-reservation:' || p_reservation_id::text, 0));
  select * into v_reservation from public.adelaide_inventory_reservations
   where id = p_reservation_id and client_id = p_client_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_reservation.external_order_reference <> btrim(p_order_reference) then
    raise exception 'ORDER_REFERENCE_MISMATCH' using errcode = '22023'; end if;
  select * into v_existing from public.adelaide_order_inventory_commits
   where client_id = p_client_id and external_order_reference = btrim(p_order_reference) for update;
  if found and v_existing.state_request_id = p_request_id then
    if v_existing.state_request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023'; end if;
    return to_jsonb(v_existing);
  end if;
  if found and v_existing.reservation_id <> p_reservation_id then raise exception 'ORDER_REFERENCE_MISMATCH' using errcode = '23505'; end if;
  if found and v_existing.payment_status='paid' and p_payment_status='pending' then
    raise exception 'INVALID_PAYMENT_REGRESSION' using errcode='23514'; end if;
  v_commit_request_id := coalesce(v_existing.commit_request_id, v_reservation.commit_request_id,
    pg_catalog.md5('adelaide-paid-commit:' || p_client_id || ':' || p_order_reference)::uuid);
  if p_payment_status = 'paid' then
    if v_reservation.status = 'committed' then v_state := 'committed';
    elsif v_reservation.status in ('released','expired') then v_state := 'manual_review'; else v_state := 'commit_pending'; end if;
    update public.adelaide_inventory_reservations set paid_protected_at = coalesce(paid_protected_at, now()), updated_at = now()
     where id = p_reservation_id;
  elsif p_order_status in ('cancelled','refunded') then v_state := case when v_reservation.status = 'committed' then 'manual_review' else 'release_pending' end;
  else v_state := case when v_reservation.status = 'active' then 'payment_pending' else v_reservation.status end;
  end if;
  insert into public.adelaide_order_inventory_commits(client_id, external_order_reference, reservation_id,
    payment_status, order_status, inventory_state, state_request_id, state_request_hash, commit_request_id, next_retry_at, committed_at)
  values (p_client_id, btrim(p_order_reference), p_reservation_id, p_payment_status, p_order_status, v_state,
    p_request_id, p_request_hash, v_commit_request_id, case when v_state = 'commit_pending' then now() end,
    case when v_state='committed' then coalesce(v_reservation.committed_at,now()) end)
  on conflict (client_id, external_order_reference) do update set
    payment_status = excluded.payment_status, order_status = excluded.order_status,
    inventory_state = case when public.adelaide_order_inventory_commits.inventory_state = 'committed' then 'committed' else excluded.inventory_state end,
    state_request_id = excluded.state_request_id, state_request_hash = excluded.state_request_hash,
    next_retry_at = case when public.adelaide_order_inventory_commits.inventory_state = 'committed' then null else excluded.next_retry_at end,
    committed_at = case when excluded.inventory_state='committed' then coalesce(public.adelaide_order_inventory_commits.committed_at,v_reservation.committed_at,now()) else public.adelaide_order_inventory_commits.committed_at end,
    updated_at = now()
  returning * into v_existing;
  perform private.adelaide_audit('ADELAIDE_ORDER_STATE_RECORDED', 'adelaide_order_inventory_commit', v_existing.id::text,
    v_reservation.location_id, p_client_id, jsonb_build_object('order_reference', p_order_reference,
    'payment_status', p_payment_status, 'order_status', p_order_status, 'inventory_state', v_existing.inventory_state,
    'request_id', p_request_id));
  return to_jsonb(v_existing);
end;
$$;

create or replace function public.process_adelaide_commit_queue(p_client_id text, p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job public.adelaide_order_inventory_commits%rowtype; v_ok integer := 0; v_failed integer := 0; v_error text;
begin
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode = '22023'; end if;
  for v_job in select * from public.adelaide_order_inventory_commits
    where client_id = p_client_id and inventory_state = 'commit_pending' and coalesce(next_retry_at, now()) <= now()
    order by coalesce(next_retry_at, created_at), id for update skip locked limit p_limit
  loop
    begin
      update public.adelaide_order_inventory_commits set attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
       where id = v_job.id;
      perform public.commit_adelaide_inventory_sale(v_job.client_id, v_job.reservation_id, v_job.commit_request_id,
        encode(extensions.digest(convert_to(v_job.external_order_reference, 'UTF8'), 'sha256'), 'hex'), v_job.external_order_reference);
      update public.adelaide_order_inventory_commits set inventory_state = 'committed', committed_at = now(), next_retry_at = null,
        last_error_code = null, updated_at = now() where id = v_job.id;
      perform private.adelaide_audit('ADELAIDE_ORDER_INVENTORY_COMMITTED', 'adelaide_order_inventory_commit', v_job.id::text,
        null, v_job.client_id, jsonb_build_object('reservation_id', v_job.reservation_id, 'commit_request_id', v_job.commit_request_id));
      v_ok := v_ok + 1;
    exception when others then
      v_error := case when sqlerrm ~ '^[A-Z][A-Z0-9_]{2,60}$' then sqlerrm else 'INTEGRATION_DATABASE_ERROR' end;
      update public.adelaide_order_inventory_commits set
        attempt_count = attempt_count + 1,
        inventory_state = case when attempt_count + 1 >= 8 then 'manual_review' else 'commit_pending' end,
        last_error_code = v_error,
        next_retry_at = case when attempt_count + 1 >= 8 then null else now() + make_interval(secs => least(3600, 15 * power(2, least(attempt_count + 1, 8))::integer)) end,
        updated_at = now() where id = v_job.id;
      perform private.adelaide_audit('ADELAIDE_ORDER_COMMIT_FAILED', 'adelaide_order_inventory_commit', v_job.id::text,
        null, v_job.client_id, jsonb_build_object('reservation_id', v_job.reservation_id, 'error_code', v_error));
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('processed', v_ok + v_failed, 'committed', v_ok, 'failed', v_failed);
end;
$$;

create or replace function public.run_adelaide_operation(p_client_id text, p_operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run_id uuid; v_started timestamptz:=clock_timestamp(); v_result jsonb; v_processed integer:=0; v_failed integer:=0;
begin
  if p_operation not in ('expiry','commit_retry','reconciliation') then raise exception 'INVALID_OPERATION' using errcode='22023'; end if;
  insert into public.adelaide_operation_runs(operation) values(p_operation) returning id into v_run_id;
  begin
    if p_operation='expiry' then
      v_processed:=public.expire_adelaide_inventory_reservations(p_client_id); v_result:=jsonb_build_object('expired',v_processed);
    elsif p_operation='commit_retry' then
      v_result:=public.process_adelaide_commit_queue(p_client_id,25);
      v_processed:=coalesce((v_result->>'processed')::integer,0); v_failed:=coalesce((v_result->>'failed')::integer,0);
    else
      select count(*) into v_processed from public.adelaide_integration_reconciliation();
      select count(*) into v_failed from public.adelaide_integration_reconciliation() where severity='critical';
      v_result:=jsonb_build_object('discrepancies',v_processed,'critical',v_failed);
    end if;
    update public.adelaide_operation_runs set finished_at=clock_timestamp(),duration_ms=greatest(0,(extract(epoch from clock_timestamp()-v_started)*1000)::integer),
      processed_count=v_processed,failure_count=v_failed,status=case when v_failed>0 then 'failed' else 'succeeded' end,
      error_code=case when v_failed>0 then upper(p_operation)||'_ACTION_REQUIRED' end where id=v_run_id;
    return v_result||jsonb_build_object('run_id',v_run_id);
  exception when others then
    update public.adelaide_operation_runs set finished_at=clock_timestamp(),duration_ms=greatest(0,(extract(epoch from clock_timestamp()-v_started)*1000)::integer),
      failure_count=1,status='failed',error_code=case when sqlerrm~'^[A-Z][A-Z0-9_]{2,60}$' then sqlerrm else 'OPERATION_FAILED' end where id=v_run_id;
    raise;
  end;
end;
$$;

create or replace function public.adelaide_integration_reconciliation()
returns table(severity text, discrepancy_type text, external_order_reference text, reservation_id uuid,
  mapping_id uuid, inventory_product_id uuid, request_id uuid, expected_quantity integer,
  actual_quantity integer, guidance text)
language sql security definer set search_path = '' as $$
  with movement_totals as (
    select external_reservation_id, product_id, sum(-quantity_delta)::integer quantity, count(*) line_count
    from public.inventory_movements where source_type = 'adelaide_wholesale_tyres' group by external_reservation_id, product_id
  ), reservation_sources as (
    select r.location_id, l.inventory_product_id, l.quantity
    from public.adelaide_inventory_reservations r join public.adelaide_inventory_reservation_lines l on l.reservation_id = r.id
    where r.status = 'active'
    union all
    select r.location_id, r.product_id, r.quantity from public.inventory_reservations r where r.status='active'
    union all
    select loc.id,x.product_id,x.quantity from private.awt_checkouts c
      cross join public.locations loc
      cross join lateral jsonb_to_recordset(c.lines) as x(product_id uuid,quantity integer)
      where c.state='reserved' and loc.code='REG'
  ), reserved_totals as (
    select location_id,inventory_product_id,sum(quantity)::integer quantity from reservation_sources
    group by location_id,inventory_product_id
  )
  select 'critical'::text,'paid_without_committed_inventory'::text,o.external_order_reference,o.reservation_id,null::uuid,null::uuid,o.state_request_id,null::integer,null::integer,
    'Retry with the stable commit request ID; move to manual review after the bounded retry limit.'
  from public.adelaide_order_inventory_commits o where o.payment_status='paid' and o.inventory_state<>'committed'
  union all select 'critical','committed_without_paid_order',r.external_order_reference,r.id,null::uuid,null::uuid,r.commit_request_id,null::integer,null::integer,
    'Verify payment evidence and order validity; never delete the movement. Escalate for financial correction.'
  from public.adelaide_inventory_reservations r left join public.adelaide_order_inventory_commits o on o.reservation_id=r.id
  where r.status='committed' and coalesce(o.payment_status,'')<>'paid'
  union all select 'critical','sale_movement_without_reservation',m.source_id,m.external_reservation_id,null::uuid,m.product_id,m.id,null::integer,(-m.quantity_delta)::integer,
    'Investigate the movement source and preserve the append-only ledger.'
  from public.inventory_movements m left join public.adelaide_inventory_reservations r on r.id=m.external_reservation_id
  where m.source_type='adelaide_wholesale_tyres' and r.id is null
  union all select 'critical','committed_missing_movement_line',r.external_order_reference,r.id,l.mapping_id,l.inventory_product_id,r.commit_request_id,l.quantity,coalesce(mt.quantity,0),
    'Do not post an ad-hoc movement; use an audited forward repair after confirming the reservation.'
  from public.adelaide_inventory_reservations r join public.adelaide_inventory_reservation_lines l on l.reservation_id=r.id
  left join movement_totals mt on mt.external_reservation_id=r.id and mt.product_id=l.inventory_product_id
  where r.status='committed' and coalesce(mt.quantity,0)=0
  union all select 'critical','movement_quantity_mismatch',r.external_order_reference,r.id,l.mapping_id,l.inventory_product_id,r.commit_request_id,l.quantity,mt.quantity,
    'Preserve history and post only an authorised compensating movement after investigation.'
  from public.adelaide_inventory_reservations r join public.adelaide_inventory_reservation_lines l on l.reservation_id=r.id
  join movement_totals mt on mt.external_reservation_id=r.id and mt.product_id=l.inventory_product_id where mt.quantity<>l.quantity
  union all select 'warning','active_reservation_past_expiry',r.external_order_reference,r.id,null::uuid,null::uuid,r.request_id,null::integer,null::integer,
    'Run the protected expiry worker; paid-protected reservations must instead be committed.'
  from public.adelaide_inventory_reservations r where r.status='active' and r.expires_at<=now()
  union all select 'critical','paid_reservation_released_or_expired',o.external_order_reference,o.reservation_id,null::uuid,null::uuid,o.state_request_id,null::integer,null::integer,
    'Manual review is required; do not recreate stock movements without payment and fulfilment evidence.'
  from public.adelaide_order_inventory_commits o join public.adelaide_inventory_reservations r on r.id=o.reservation_id
  where o.payment_status='paid' and r.status in ('released','expired')
  union all select 'critical','duplicate_request_or_commit_attempt',o.external_order_reference,o.reservation_id,null::uuid,null::uuid,o.commit_request_id,1,o.attempt_count,
    'Inspect delivery history and payload hashes; stable identical retries are safe.'
  from public.adelaide_order_inventory_commits o where o.attempt_count>1 and o.last_error_code='IDEMPOTENCY_KEY_REUSED'
  union all select 'critical','duplicate_order_reference',r.external_order_reference,(array_agg(r.id order by r.id))[1],null::uuid,null::uuid,null::uuid,1,count(*)::integer,
    'Investigate duplicate legacy reservations; do not merge or delete history.'
  from public.adelaide_inventory_reservations r group by r.client_id,r.external_order_reference having count(*)>1
  union all select case when wp.active and wp.sellable then 'critical' else 'warning' end,'product_mapping_invalid',wp.website_product_id,null::uuid,wp.expected_mapping_id,m.inventory_product_id,null::uuid,null::integer,null::integer,
    'Correct the permanent mapping or catalogue attributes before deployment.'
  from public.adelaide_website_products wp left join public.adelaide_product_mappings m on m.website_product_id=wp.website_product_id and m.id=wp.expected_mapping_id
  left join public.products p on p.id=m.inventory_product_id
  left join public.tyre_brands b on b.id=p.tyre_brand_id left join public.tyre_patterns pat on pat.id=p.tyre_pattern_id
  left join public.tyre_sizes s on s.id=p.tyre_size_id
  where m.id is null or not p.active or upper(b.normalized_name)<>upper(wp.brand) or upper(pat.normalized_name)<>upper(wp.pattern)
    or upper(s.normalized_size)<>upper(wp.tyre_size) or p.tyre_condition<>wp.tyre_condition
    or not exists(select 1 from public.inventory_balances ib where ib.product_id=p.id and ib.location_id=wp.intended_location_id)
  union all select 'critical','reserved_total_mismatch',null::text,null::uuid,null::uuid,b.product_id,null::uuid,coalesce(rt.quantity,0),b.reserved,
    'Investigate active reservation lines and balance history; repair only through an audited forward database function.'
  from public.inventory_balances b left join reserved_totals rt on rt.inventory_product_id=b.product_id and rt.location_id=b.location_id
  where b.reserved<>coalesce(rt.quantity,0);
$$;

create or replace function public.adelaide_integration_health()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'status',case when expired_active>0 or paid_waiting>0 or repeated_failures>0 or mapping_failures>0 or reconciliation_errors>0 or cron_stale then 'action_required' else 'ok' end,
    'expired_active_reservations',expired_active,'paid_orders_waiting_for_commit',paid_waiting,
    'repeated_commit_failures',repeated_failures,'mapping_failures',mapping_failures,
    'reconciliation_errors',reconciliation_errors,'cron_stale',cron_stale,'checked_at',now()
  ) from (
    select
      (select count(*) from public.adelaide_inventory_reservations where status='active' and expires_at<=now()) expired_active,
      (select count(*) from public.adelaide_order_inventory_commits where payment_status='paid' and inventory_state<>'committed') paid_waiting,
      (select count(*) from public.adelaide_order_inventory_commits where attempt_count>=3 and inventory_state<>'committed') repeated_failures,
      (select count(*) from public.adelaide_integration_reconciliation() where discrepancy_type='product_mapping_invalid') mapping_failures,
      (select count(*) from public.adelaide_integration_reconciliation() where severity='critical') reconciliation_errors,
      not exists(select 1 from public.adelaide_operation_runs where operation='expiry' and status<>'running' and started_at>=now()-interval '20 minutes') cron_stale
  ) s;
$$;

create or replace function public.admin_adelaide_reconciliation()
returns table(severity text, discrepancy_type text, external_order_reference text, reservation_id uuid,
  mapping_id uuid, inventory_product_id uuid, request_id uuid, expected_quantity integer, actual_quantity integer, guidance text)
language plpgsql security definer set search_path = '' as $$
begin perform private.require_active_admin(); return query select * from public.adelaide_integration_reconciliation(); end;
$$;

create or replace function public.admin_adelaide_mapping_health()
returns table(website_product_id text, mapping_id uuid, inventory_product_id uuid, active boolean, sellable boolean,
  status text, issue text) language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_active_admin();
  return query
  select wp.website_product_id,m.id,m.inventory_product_id,wp.active,wp.sellable,
    case when m.id is not null and m.id=wp.expected_mapping_id and p.active
      and upper(b.normalized_name)=upper(wp.brand) and upper(pat.normalized_name)=upper(wp.pattern)
      and upper(s.normalized_size)=upper(wp.tyre_size) and p.tyre_condition=wp.tyre_condition
      and exists(select 1 from public.inventory_balances ib where ib.product_id=p.id and ib.location_id=wp.intended_location_id)
      then 'valid' else 'invalid' end,
    case when m.id is null then 'missing_mapping' when m.id<>wp.expected_mapping_id then 'unstable_mapping_id'
      when not p.active then 'inactive_inventory_product'
      when upper(b.normalized_name)<>upper(wp.brand) or upper(pat.normalized_name)<>upper(wp.pattern)
        or upper(s.normalized_size)<>upper(wp.tyre_size) or p.tyre_condition<>wp.tyre_condition then 'attribute_mismatch'
      when not exists(select 1 from public.inventory_balances ib where ib.product_id=p.id and ib.location_id=wp.intended_location_id) then 'wrong_branch'
      else null end
  from public.adelaide_website_products wp left join public.adelaide_product_mappings m on m.website_product_id=wp.website_product_id
  left join public.products p on p.id=m.inventory_product_id left join public.tyre_brands b on b.id=p.tyre_brand_id
  left join public.tyre_patterns pat on pat.id=p.tyre_pattern_id left join public.tyre_sizes s on s.id=p.tyre_size_id
  order by wp.website_product_id;
end;
$$;

create or replace function public.admin_recover_adelaide_paid_order(p_order_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_job public.adelaide_order_inventory_commits%rowtype;
begin
  v_actor:=private.require_active_admin();
  select * into v_job from public.adelaide_order_inventory_commits where external_order_reference=btrim(p_order_reference) for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if v_job.payment_status<>'paid' then raise exception 'ORDER_NOT_PAID' using errcode='23514'; end if;
  if v_job.inventory_state='committed' then return to_jsonb(v_job); end if;
  update public.adelaide_order_inventory_commits set inventory_state='commit_pending',next_retry_at=now(),last_error_code=null,updated_at=now() where id=v_job.id;
  insert into public.audit_events(actor_user_id,actor_role,event_type,entity_type,entity_id,details)
   values(v_actor,'admin','ADELAIDE_ORDER_MANUAL_RECOVERY_REQUESTED','adelaide_order_inventory_commit',v_job.id::text,
    jsonb_build_object('order_reference',v_job.external_order_reference,'reservation_id',v_job.reservation_id));
  return jsonb_build_object('status','commit_pending','order_reference',v_job.external_order_reference,
    'reservation_id',v_job.reservation_id,'commit_request_id',v_job.commit_request_id);
end;
$$;

create or replace function public.admin_update_manager(
  p_user_id uuid, p_active boolean default null, p_discount_cap numeric default null, p_update_discount boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_target public.user_profiles%rowtype;
begin
  v_actor := private.require_active_admin();
  select * into v_target from public.user_profiles where user_id=p_user_id and role='manager' for update;
  if not found then raise exception 'MANAGER_NOT_FOUND' using errcode='P0002'; end if;
  if p_update_discount and (p_discount_cap is not null and (p_discount_cap<0 or p_discount_cap>100)) then
    raise exception 'INVALID_DISCOUNT_CAP' using errcode='22023'; end if;
  update public.user_profiles set active=coalesce(p_active,active),
    finance_discount_limit_percent=case when p_update_discount then p_discount_cap else finance_discount_limit_percent end,
    updated_at=now() where user_id=p_user_id;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(v_actor,'admin',v_target.location_id,
    case when p_update_discount then 'MANAGER_DISCOUNT_CAP_UPDATED' when p_active then 'MANAGER_ENABLED' else 'MANAGER_DISABLED' end,
    'user_profile',p_user_id::text,jsonb_build_object('active',p_active,'finance_discount_limit_percent',p_discount_cap));
end;
$$;

create or replace function public.admin_begin_manager_invitation(p_email text, p_desired_profile jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid; v_hash text;
begin
  v_actor:=private.require_active_admin();
  if nullif(btrim(p_email),'') is null or jsonb_typeof(p_desired_profile)<>'object' then
    raise exception 'INVALID_INVITATION' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(lower(btrim(p_email)),'UTF8'),'sha256'),'hex');
  insert into public.manager_invitation_operations(email_hash,requested_by,desired_profile,status)
   values(v_hash,v_actor,p_desired_profile,'pending_auth') returning id into v_id;
  insert into public.audit_events(actor_user_id,actor_role,event_type,entity_type,entity_id,details)
   values(v_actor,'admin','MANAGER_INVITATION_STARTED','manager_invitation_operation',v_id::text,
    jsonb_build_object('email_hash',v_hash));
  return v_id;
exception when unique_violation then raise exception 'INVITATION_ALREADY_PENDING' using errcode='23505';
end;
$$;

create or replace function public.admin_complete_manager_invitation(p_operation_id uuid, p_auth_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_op public.manager_invitation_operations%rowtype; v_permission jsonb;
begin
  v_actor:=private.require_active_admin();
  select * into v_op from public.manager_invitation_operations where id=p_operation_id for update;
  if not found or v_op.requested_by<>v_actor or v_op.status not in ('pending_auth','auth_invited') then
    raise exception 'INVITATION_NOT_RECOVERABLE' using errcode='23514'; end if;
  update public.manager_invitation_operations set auth_user_id=p_auth_user_id,status='auth_invited',updated_at=now() where id=v_op.id;
  insert into public.user_profiles(user_id,display_name,role,location_id,finance_discount_limit_percent)
  values(p_auth_user_id,v_op.desired_profile->>'display_name','manager',(v_op.desired_profile->>'location_id')::uuid,
    nullif(v_op.desired_profile->>'finance_discount_limit_percent','')::numeric);
  for v_permission in select value from jsonb_array_elements(coalesce(v_op.desired_profile->'permissions','[]'::jsonb))
  loop
    insert into public.manager_permissions(user_id,permission_key,enabled) values(p_auth_user_id,v_permission#>>'{}',true);
  end loop;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(v_actor,'admin',(v_op.desired_profile->>'location_id')::uuid,'MANAGER_INVITED','user_profile',p_auth_user_id::text,
    v_op.desired_profile-'location_id');
  update public.manager_invitation_operations set status='completed',updated_at=now() where id=v_op.id;
end;
$$;

create or replace function public.admin_set_invitation_compensation(
  p_operation_id uuid, p_auth_user_id uuid, p_compensated boolean, p_error_code text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_status text;
begin
  v_actor:=private.require_active_admin();
  v_status:=case when p_compensated then 'compensated' else 'manual_review' end;
  update public.manager_invitation_operations set auth_user_id=coalesce(p_auth_user_id,auth_user_id),status=v_status,
    last_error_code=left(coalesce(p_error_code,'UNKNOWN'),80),updated_at=now()
   where id=p_operation_id and requested_by=v_actor and status<>'completed';
  if not found then raise exception 'INVITATION_NOT_RECOVERABLE' using errcode='23514'; end if;
  insert into public.audit_events(actor_user_id,actor_role,event_type,entity_type,entity_id,details)
   values(v_actor,'admin',case when p_compensated then 'MANAGER_INVITATION_COMPENSATED' else 'MANAGER_INVITATION_MANUAL_REVIEW' end,
    'manager_invitation_operation',p_operation_id::text,jsonb_build_object('error_code',left(coalesce(p_error_code,'UNKNOWN'),80)));
end;
$$;

revoke execute on function public.record_adelaide_integration_request(text,uuid,text,text,text),
  public.register_adelaide_order_state(text,uuid,text,uuid,text,text,text),
  public.process_adelaide_commit_queue(text,integer), public.adelaide_integration_reconciliation(),
  public.run_adelaide_operation(text,text), public.adelaide_integration_health(),
  public.admin_adelaide_reconciliation(), public.admin_update_manager(uuid,boolean,numeric,boolean)
  , public.admin_adelaide_mapping_health(), public.admin_recover_adelaide_paid_order(text)
  , public.admin_begin_manager_invitation(text,jsonb), public.admin_complete_manager_invitation(uuid,uuid)
  , public.admin_set_invitation_compensation(uuid,uuid,boolean,text)
from public, anon, authenticated;
grant execute on function public.record_adelaide_integration_request(text,uuid,text,text,text),
  public.register_adelaide_order_state(text,uuid,text,uuid,text,text,text),
  public.process_adelaide_commit_queue(text,integer), public.adelaide_integration_reconciliation()
  , public.run_adelaide_operation(text,text), public.adelaide_integration_health()
to service_role;
grant execute on function public.admin_adelaide_reconciliation(), public.admin_update_manager(uuid,boolean,numeric,boolean)
  , public.admin_adelaide_mapping_health(), public.admin_recover_adelaide_paid_order(text)
  , public.admin_begin_manager_invitation(text,jsonb), public.admin_complete_manager_invitation(uuid,uuid)
  , public.admin_set_invitation_compensation(uuid,uuid,boolean,text)
to authenticated;
