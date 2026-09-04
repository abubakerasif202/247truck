-- Assign cost to previously unvalued opening stock without mutating the
-- original quantity movement. Current WAC is reconstructed from chronological
-- movement history so subsequent receipts/outbound activity are respected.

create table public.opening_stock_cost_assignments (
  opening_movement_id uuid primary key references public.inventory_movements(id),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now()
);

alter table public.opening_stock_cost_assignments enable row level security;
revoke all on public.opening_stock_cost_assignments
  from public, anon, authenticated, service_role;
grant select on public.opening_stock_cost_assignments to service_role;

create or replace function private.prevent_opening_cost_assignment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'OPENING_COST_ASSIGNMENT_IMMUTABLE' using errcode = '55000';
end;
$$;

revoke execute on function private.prevent_opening_cost_assignment_mutation()
  from public, anon, authenticated, service_role;

create trigger opening_stock_cost_assignments_immutable
before update or delete on public.opening_stock_cost_assignments
for each row execute function private.prevent_opening_cost_assignment_mutation();

create or replace function private.rebuild_current_wac(
  p_product_id uuid,
  p_location_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.inventory_balances%rowtype;
  v_movement record;
  v_quantity integer := 0;
  v_before_quantity integer;
  v_wac numeric(14,4) := 0;
  v_unit_cost numeric(14,4);
begin
  select * into v_balance
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
    and balance.location_id = p_location_id
  for update;

  if not found then
    raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  for v_movement in
    select
      movement.id,
      movement.quantity_delta,
      movement.movement_type,
      movement.inbound_unit_cost,
      assignment.unit_cost as assigned_opening_cost
    from public.inventory_movements as movement
    left join public.opening_stock_cost_assignments as assignment
      on assignment.opening_movement_id = movement.id
    where movement.product_id = p_product_id
      and movement.location_id = p_location_id
    order by movement.created_at, movement.id
  loop
    if v_movement.movement_type in (
      'opening_stock', 'quick_stock_in', 'used_unit_in', 'purchase_receipt'
    ) then
      v_before_quantity := v_quantity;
      v_quantity := v_quantity + v_movement.quantity_delta;

      v_unit_cost := case
        when v_movement.movement_type = 'opening_stock'
          then coalesce(
            v_movement.inbound_unit_cost,
            v_movement.assigned_opening_cost
          )
        else v_movement.inbound_unit_cost
      end;

      if v_quantity < 0 then
        raise exception 'WAC_REPLAY_NEGATIVE_STOCK' using errcode = '23514';
      end if;

      if v_unit_cost is null then
        v_wac := null;
      elsif v_before_quantity = 0 then
        v_wac := v_unit_cost;
      elsif v_wac is null then
        v_wac := null;
      else
        v_wac := (
          (v_before_quantity * v_wac)
          + (v_movement.quantity_delta * v_unit_cost)
        ) / v_quantity;
      end if;
    else
      -- Stock-out and adjustments change quantity but do not establish a new
      -- cost basis. Preserve the existing WAC until quantity reaches zero.
      v_quantity := v_quantity + v_movement.quantity_delta;
      if v_quantity < 0 then
        raise exception 'WAC_REPLAY_NEGATIVE_STOCK' using errcode = '23514';
      end if;
    end if;

    if v_quantity = 0 then
      v_wac := 0;
    end if;
  end loop;

  if v_quantity <> v_balance.on_hand then
    raise exception 'WAC_REPLAY_BALANCE_MISMATCH' using errcode = '55000';
  end if;

  update public.inventory_balances
  set weighted_average_cost = v_wac,
      updated_at = now()
  where product_id = p_product_id
    and location_id = p_location_id;

  return v_wac;
end;
$$;

revoke execute on function private.rebuild_current_wac(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.list_pending_opening_costs(
  p_product_id uuid,
  p_location_id uuid
)
returns table (
  movement_id uuid,
  quantity integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    movement.id,
    movement.quantity_delta,
    movement.created_at
  from public.inventory_movements as movement
  where movement.product_id = p_product_id
    and movement.location_id = p_location_id
    and movement.movement_type = 'opening_stock'
    and movement.inbound_unit_cost is null
    and not exists (
      select 1
      from public.opening_stock_cost_assignments as assignment
      where assignment.opening_movement_id = movement.id
    )
  order by movement.created_at, movement.id;
end;
$$;

revoke execute on function public.list_pending_opening_costs(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.list_pending_opening_costs(uuid, uuid)
  to authenticated;

create or replace function public.assign_opening_stock_cost(
  p_opening_movement_id uuid,
  p_unit_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_movement public.inventory_movements%rowtype;
begin
  if v_actor is null or not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_opening_movement_id is null then
    raise exception 'MOVEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'INVALID_COST' using errcode = '22023';
  end if;

  -- Lock the immutable source movement so concurrent assignment attempts
  -- serialize even though the movement itself is never changed.
  select * into v_movement
  from public.inventory_movements as movement
  where movement.id = p_opening_movement_id
  for update;

  if not found then
    raise exception 'MOVEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_movement.movement_type <> 'opening_stock' then
    raise exception 'NOT_OPENING_STOCK' using errcode = '22023';
  end if;
  if v_movement.inbound_unit_cost is not null then
    raise exception 'OPENING_COST_ALREADY_KNOWN' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.opening_stock_cost_assignments as assignment
    where assignment.opening_movement_id = p_opening_movement_id
  ) then
    raise exception 'OPENING_COST_ALREADY_ASSIGNED' using errcode = '23505';
  end if;

  insert into public.opening_stock_cost_assignments (
    opening_movement_id,
    unit_cost,
    assigned_by
  )
  values (
    p_opening_movement_id,
    p_unit_cost,
    v_actor
  );

  perform private.rebuild_current_wac(
    v_movement.product_id,
    v_movement.location_id
  );

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
    v_actor,
    'admin',
    v_movement.location_id,
    'OPENING_STOCK_COST_ASSIGNED',
    'inventory_movement',
    p_opening_movement_id::text,
    jsonb_build_object(
      'product_id', v_movement.product_id,
      'location_id', v_movement.location_id,
      'opening_movement_id', p_opening_movement_id,
      'unit_cost', p_unit_cost,
      'quantity', v_movement.quantity_delta
    )
  );
end;
$$;

revoke execute on function public.assign_opening_stock_cost(uuid, numeric)
  from public, anon, service_role;
grant execute on function public.assign_opening_stock_cost(uuid, numeric)
  to authenticated;
