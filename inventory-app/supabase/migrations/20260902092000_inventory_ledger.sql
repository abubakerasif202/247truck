-- Atomic inventory ledger: balances, append-only movements, WAC, no-negative
-- stock, idempotent posting, and atomic individual used-tyre intake.
-- Depends on 20260902090000_identity_access.sql and 20260902091000_product_catalog.sql.

create table public.inventory_balances (
  product_id uuid not null references public.products (id),
  location_id uuid not null references public.locations (id),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0
    check (reserved >= 0 and reserved <= on_hand),
  weighted_average_cost numeric(14, 4) not null default 0
    check (weighted_average_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, location_id)
);

create table public.inventory_movements (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null,
  product_id uuid not null references public.products (id),
  used_tyre_unit_id uuid references public.used_tyre_units (id),
  location_id uuid not null references public.locations (id),
  quantity_delta integer not null check (quantity_delta <> 0),
  movement_type text not null check (
    movement_type in (
      'quick_stock_in', 'stock_out', 'adjustment', 'used_unit_in', 'used_unit_out'
    )
  ),
  -- Movement direction is bound to type: inbound types add, outbound types
  -- remove, only 'adjustment' may go either way. Without this a caller holding
  -- only stock_out could inflate stock by passing a positive delta.
  constraint inventory_movements_direction_check check (
    (movement_type in ('quick_stock_in', 'used_unit_in') and quantity_delta > 0)
    or (movement_type in ('stock_out', 'used_unit_out') and quantity_delta < 0)
    or movement_type = 'adjustment'
  ),
  reason text,
  source_type text,
  source_id text,
  supplier_name text,
  inbound_unit_cost numeric(14, 4),
  cost_snapshot numeric(14, 4) not null,
  actor_user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index inventory_movements_product_location_idx
  on public.inventory_movements (product_id, location_id, created_at desc);
create index inventory_movements_location_created_idx
  on public.inventory_movements (location_id, created_at desc);
create index inventory_movements_used_unit_idx
  on public.inventory_movements (used_tyre_unit_id);
-- Idempotency is deliberately scoped to the acting user and location. A
-- globally unique client-generated key lets a caller probe another branch's
-- result by replaying its key. This constraint still prevents duplicate work
-- for a given caller and branch without creating a cross-branch side channel.
create unique index inventory_movements_actor_location_request_id_key
  on public.inventory_movements (actor_user_id, location_id, request_id);

create sequence public.used_tyre_unit_code_seq;

-- Seed zero balances for every existing product x location. This is NOT a
-- stock movement.
insert into public.inventory_balances (product_id, location_id)
select p.id, l.id
from public.products as p
cross join public.locations as l
on conflict do nothing;

create or replace function private.seed_inventory_balances()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.inventory_balances (product_id, location_id)
  select new.id, location.id from public.locations as location
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function private.seed_inventory_balances()
  from public, anon, authenticated, service_role;

create trigger products_seed_inventory_balances
after insert on public.products
for each row execute function private.seed_inventory_balances();

-- Append-only guard on movements ----------------------------------------------

create or replace function private.prevent_movement_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'inventory movements are append-only'
    using errcode = '42501';
end;
$$;

create trigger inventory_movements_append_only
before update or delete on public.inventory_movements
for each row execute function private.prevent_movement_mutation();

create trigger inventory_movements_prevent_truncate
before truncate on public.inventory_movements
for each statement execute function private.prevent_movement_mutation();

-- RLS ------------------------------------------------------------------------

alter table public.inventory_balances enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on public.inventory_balances from public, anon, authenticated, service_role;
revoke all on public.inventory_movements from public, anon, authenticated, service_role;

-- RLS only controls rows. Column-level grants keep WAC and movement cost
-- snapshots out of direct PostgREST/base-table reads; approved cost-gated
-- interfaces return them only to inventory.view_cost users.
grant select (product_id, location_id, on_hand, reserved, updated_at)
  on public.inventory_balances to authenticated;
grant select (
  id, request_id, product_id, used_tyre_unit_id, location_id, quantity_delta,
  movement_type, reason, source_type, source_id, supplier_name, actor_user_id, created_at
) on public.inventory_movements to authenticated;
-- service_role gets SELECT only: every ledger write goes through the SECURITY
-- DEFINER RPCs so WAC, the no-negative guard, movement<->balance consistency,
-- and the audit write cannot be bypassed by a service-client code path.
grant select on public.inventory_balances to service_role;
grant select on public.inventory_movements to service_role;

create policy inventory_balances_read on public.inventory_balances
  for select to authenticated
  using (
    (select private.app_is_admin())
    or location_id = (select private.app_user_location_id())
  );

create policy inventory_movements_read on public.inventory_movements
  for select to authenticated
  using (
    (select private.app_is_admin())
    or location_id = (select private.app_user_location_id())
  );

-- Authorisation helper ------------------------------------------------------

create or replace function private.assert_stock_authorization(
  p_location_id uuid,
  p_movement_type text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_actor_location uuid;
  v_permission text;
begin
  if v_actor is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  select profile.role, profile.location_id
  into v_role, v_actor_location
  from public.user_profiles as profile
  where profile.user_id = v_actor and profile.active;

  if not found then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if v_role = 'manager' and p_location_id is distinct from v_actor_location then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  v_permission := case p_movement_type
    when 'quick_stock_in' then 'inventory.stock_in'
    when 'used_unit_in' then 'inventory.stock_in'
    when 'stock_out' then 'inventory.stock_out'
    when 'used_unit_out' then 'inventory.stock_out'
    when 'adjustment' then 'inventory.adjust'
    else null
  end;

  if v_permission is null then
    raise exception 'INVALID_MOVEMENT_TYPE' using errcode = '22023';
  end if;

  if not private.app_has_permission(v_permission) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return v_role;
end;
$$;

revoke execute on function private.assert_stock_authorization(uuid, text)
  from public, anon, authenticated, service_role;

-- post_inventory_movement --------------------------------------------------

create or replace function public.post_inventory_movement(
  p_request_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity_delta integer,
  p_movement_type text,
  p_reason text default null,
  p_inbound_unit_cost numeric default null,
  p_used_tyre_unit_id uuid default null,
  p_source_type text default null,
  p_source_id text default null,
  p_supplier_name text default null
)
returns table (
  movement_id uuid,
  on_hand integer,
  reserved integer,
  available integer,
  weighted_average_cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_balance public.inventory_balances%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_new_on_hand integer;
  v_new_wac numeric(14, 4);
  v_movement_id uuid;
begin
  if p_quantity_delta = 0 then
    raise exception 'NO_STOCK_CHANGE' using errcode = '22023';
  end if;

  -- Direction is bound to movement type (defense-in-depth over the table CHECK).
  if (p_movement_type in ('quick_stock_in', 'used_unit_in') and p_quantity_delta <= 0)
    or (p_movement_type in ('stock_out', 'used_unit_out') and p_quantity_delta >= 0)
  then
    raise exception 'INVALID_MOVEMENT_DIRECTION' using errcode = '22023';
  end if;

  v_role := private.assert_stock_authorization(p_location_id, p_movement_type);

  -- Idempotency: a replayed request_id returns the current balance untouched.
  select * into v_existing
  from public.inventory_movements
  where request_id = p_request_id
    and actor_user_id = v_actor
    and location_id = p_location_id;

  if found then
    if v_existing.product_id <> p_product_id
      or v_existing.movement_type <> p_movement_type then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select * into v_balance
    from public.inventory_balances
    where product_id = v_existing.product_id
      and location_id = v_existing.location_id;
    return query select
      v_existing.id, v_balance.on_hand, v_balance.reserved,
      v_balance.on_hand - v_balance.reserved,
      case when private.app_has_permission('inventory.view_cost')
        then v_balance.weighted_average_cost end;
    return;
  end if;

  select * into v_balance
  from public.inventory_balances
  where product_id = p_product_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new_on_hand := v_balance.on_hand + p_quantity_delta;

  if v_new_on_hand < 0 or v_new_on_hand < v_balance.reserved then
    raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
  end if;

  v_new_wac := v_balance.weighted_average_cost;

  if p_movement_type in ('quick_stock_in', 'used_unit_in') then
    if p_inbound_unit_cost is null or p_inbound_unit_cost < 0 then
      raise exception 'INBOUND_COST_REQUIRED' using errcode = '22023';
    end if;
    v_new_wac := (
      (v_balance.on_hand * v_balance.weighted_average_cost)
      + (p_quantity_delta * p_inbound_unit_cost)
    ) / v_new_on_hand;
  end if;

  if p_movement_type = 'adjustment' and trim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  begin
    insert into public.inventory_movements (
      request_id, product_id, used_tyre_unit_id, location_id, quantity_delta,
      movement_type, reason, source_type, source_id, supplier_name, inbound_unit_cost,
      cost_snapshot, actor_user_id
    )
    values (
      p_request_id, p_product_id, p_used_tyre_unit_id, p_location_id, p_quantity_delta,
      p_movement_type, nullif(trim(coalesce(p_reason, '')), ''), p_source_type, p_source_id,
      nullif(trim(coalesce(p_supplier_name, '')), ''),
      case when p_quantity_delta > 0 then p_inbound_unit_cost else null end,
      v_new_wac, v_actor
    )
    returning id into v_movement_id;
  exception when unique_violation then
    -- A concurrent request with the same request_id won the race. Return the
    -- committed balance idempotently instead of surfacing a raw error.
    select * into v_existing
    from public.inventory_movements
    where request_id = p_request_id
      and actor_user_id = v_actor
      and location_id = p_location_id;
    if not found then
      raise;
    end if;
    if v_existing.product_id <> p_product_id
      or v_existing.movement_type <> p_movement_type then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select * into v_balance
    from public.inventory_balances
    where product_id = v_existing.product_id and location_id = v_existing.location_id;
    return query select
      v_existing.id, v_balance.on_hand, v_balance.reserved,
      v_balance.on_hand - v_balance.reserved,
      case when private.app_has_permission('inventory.view_cost')
        then v_balance.weighted_average_cost end;
    return;
  end;

  update public.inventory_balances
  set on_hand = v_new_on_hand,
      weighted_average_cost = v_new_wac,
      updated_at = now()
  where product_id = p_product_id and location_id = p_location_id;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details
  )
  values (
    v_actor, v_role, p_location_id,
    case p_movement_type
      when 'adjustment' then 'INVENTORY_ADJUSTED'
      when 'stock_out' then 'STOCK_OUT'
      when 'used_unit_out' then 'STOCK_OUT'
      else 'STOCK_IN'
    end,
    'inventory_movement', v_movement_id::text,
    jsonb_build_object(
      'product_id', p_product_id,
      'quantity_delta', p_quantity_delta,
      'movement_type', p_movement_type,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'on_hand_before', v_balance.on_hand,
      'on_hand_after', v_new_on_hand
    )
  );

  return query select
    v_movement_id, v_new_on_hand, v_balance.reserved,
    v_new_on_hand - v_balance.reserved,
    case when private.app_has_permission('inventory.view_cost') then v_new_wac end;
end;
$$;

-- set_inventory_count (absolute adjustment) ------------------------------------

create or replace function public.set_inventory_count(
  p_request_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_counted_quantity integer,
  p_reason text,
  p_notes text default null
)
returns table (
  movement_id uuid,
  on_hand integer,
  reserved integer,
  available integer,
  weighted_average_cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_balance public.inventory_balances%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_delta integer;
begin
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_counted_quantity < 0 then
    raise exception 'INVALID_COUNT' using errcode = '22023';
  end if;

  perform private.assert_stock_authorization(p_location_id, 'adjustment');

  -- Idempotency is limited to this caller + branch, before any record is read.
  select * into v_existing
  from public.inventory_movements
  where request_id = p_request_id
    and actor_user_id = v_actor
    and location_id = p_location_id;
  if found then
    if v_existing.product_id <> p_product_id
      or v_existing.movement_type <> 'adjustment' then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select * into v_balance
    from public.inventory_balances
    where product_id = v_existing.product_id and location_id = v_existing.location_id;
    return query select
      v_existing.id, v_balance.on_hand, v_balance.reserved,
      v_balance.on_hand - v_balance.reserved,
      case when private.app_has_permission('inventory.view_cost')
        then v_balance.weighted_average_cost end;
    return;
  end if;

  select * into v_balance
  from public.inventory_balances
  where product_id = p_product_id and location_id = p_location_id
  for update;

  if not found then
    raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_counted_quantity < v_balance.reserved then
    raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
  end if;

  v_delta := p_counted_quantity - v_balance.on_hand;
  if v_delta = 0 then
    raise exception 'NO_STOCK_CHANGE' using errcode = '22023';
  end if;

  return query
  select * from public.post_inventory_movement(
    p_request_id, p_product_id, p_location_id, v_delta, 'adjustment',
    trim(p_reason)
      || case when nullif(trim(coalesce(p_notes, '')), '') is not null
              then ' (' || trim(p_notes) || ')' else '' end,
    null, null, 'stocktake_correction', null, null
  );
end;
$$;

-- create_used_tyre_unit_with_stock -------------------------------------------

create or replace function public.create_used_tyre_unit_with_stock(
  p_request_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_tread_depth_mm numeric,
  p_condition text,
  p_cost_basis numeric,
  p_selling_price_override numeric default null,
  p_notes text default null
)
returns table (
  unit_id uuid,
  unit_code text,
  movement_id uuid,
  on_hand integer,
  reserved integer,
  available integer,
  weighted_average_cost numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_unit_id uuid;
  v_unit_code text;
  v_product public.products%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_unit public.used_tyre_units%rowtype;
  v_movement record;
begin
  if p_tread_depth_mm is null or p_tread_depth_mm < 0 then
    raise exception 'INVALID_TREAD_DEPTH' using errcode = '22023';
  end if;
  if p_condition not in ('excellent', 'good', 'fair', 'scrap') then
    raise exception 'INVALID_CONDITION' using errcode = '22023';
  end if;
  if p_cost_basis is null or p_cost_basis < 0 then
    raise exception 'INVALID_COST' using errcode = '22023';
  end if;

  perform private.assert_stock_authorization(p_location_id, 'used_unit_in');

  -- Idempotency + invariant guard ("no available unit without a stock
  -- movement"): a replay must not mint a second unit/sequence value. Return the
  -- unit the first call already created.
  select * into v_existing
  from public.inventory_movements
  where request_id = p_request_id
    and actor_user_id = v_actor
    and location_id = p_location_id;
  if found then
    if v_existing.product_id <> p_product_id
      or v_existing.movement_type <> 'used_unit_in' then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select * into v_unit
    from public.used_tyre_units where id = v_existing.used_tyre_unit_id;
    return query select
      v_unit.id, v_unit.internal_unit_code, v_existing.id,
      b.on_hand, b.reserved, b.on_hand - b.reserved,
      case when private.app_has_permission('inventory.view_cost')
        then b.weighted_average_cost end
    from public.inventory_balances as b
    where b.product_id = v_existing.product_id
      and b.location_id = v_existing.location_id;
    return;
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_product.category_code <> 'truck_tyre' or v_product.tyre_condition <> 'used' then
    raise exception 'NOT_A_USED_TYRE' using errcode = '22023';
  end if;

  v_unit_code := 'UT-' || lpad(nextval('public.used_tyre_unit_code_seq')::text, 6, '0');

  insert into public.used_tyre_units (
    product_id, location_id, internal_unit_code, tread_depth_mm, condition,
    cost_basis, selling_price_override, status, notes
  )
  values (
    p_product_id, p_location_id, v_unit_code, p_tread_depth_mm, p_condition,
    p_cost_basis, p_selling_price_override, 'available', nullif(p_notes, '')
  )
  returning id into v_unit_id;

  select * into v_movement from public.post_inventory_movement(
    p_request_id, p_product_id, p_location_id, 1, 'used_unit_in',
    null, p_cost_basis, v_unit_id, 'used_tyre_unit', v_unit_id::text
  );

  return query select
    v_unit_id, v_unit_code, v_movement.movement_id, v_movement.on_hand,
    v_movement.reserved, v_movement.available, v_movement.weighted_average_cost;
end;
$$;

-- Grants -------------------------------------------------------------------

revoke execute on function public.post_inventory_movement(
  uuid, uuid, uuid, integer, text, text, numeric, uuid, text, text, text
) from public, anon, service_role;
revoke execute on function public.set_inventory_count(
  uuid, uuid, uuid, integer, text, text
) from public, anon, service_role;
revoke execute on function public.create_used_tyre_unit_with_stock(
  uuid, uuid, uuid, numeric, text, numeric, numeric, text
) from public, anon, service_role;

grant execute on function public.post_inventory_movement(
  uuid, uuid, uuid, integer, text, text, numeric, uuid, text, text, text
) to authenticated;
grant execute on function public.set_inventory_count(
  uuid, uuid, uuid, integer, text, text
) to authenticated;
grant execute on function public.create_used_tyre_unit_with_stock(
  uuid, uuid, uuid, numeric, text, numeric, numeric, text
) to authenticated;
