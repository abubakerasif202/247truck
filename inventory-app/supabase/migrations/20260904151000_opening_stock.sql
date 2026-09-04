-- Dedicated Admin-only opening-stock posting path.
-- Opening stock may carry a NULL inbound cost while ordinary stock-in and PO
-- receiving continue to require a known non-negative cost.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (
    movement_type in (
      'quick_stock_in', 'stock_out', 'adjustment', 'used_unit_in',
      'used_unit_out', 'purchase_receipt', 'opening_stock'
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_direction_check;

alter table public.inventory_movements
  add constraint inventory_movements_direction_check check (
    (movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt', 'opening_stock')
      and quantity_delta > 0)
    or (movement_type in ('stock_out', 'used_unit_out') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );

create or replace function public.post_opening_stock(
  p_request_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity integer,
  p_inbound_unit_cost numeric default null,
  p_source_type text default null,
  p_source_id text default null
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
  v_new_on_hand integer;
  v_new_wac numeric(14, 4);
  v_movement_id uuid;
begin
  if v_actor is null or not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_request_id is null or p_product_id is null or p_location_id is null then
    raise exception 'INVALID_OPENING_STOCK' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_OPENING_QUANTITY' using errcode = '22023';
  end if;
  if p_inbound_unit_cost is not null and p_inbound_unit_cost < 0 then
    raise exception 'INVALID_COST' using errcode = '22023';
  end if;

  -- Serialize retries for the same actor + branch + request before examining
  -- replay state, avoiding both duplicate postings and cross-branch probing.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_location_id::text || ':' || p_request_id::text,
      0
    )
  );

  select * into v_existing
  from public.inventory_movements as movement
  where movement.request_id = p_request_id
    and movement.actor_user_id = v_actor
    and movement.location_id = p_location_id;

  if found then
    if v_existing.product_id <> p_product_id
      or v_existing.movement_type <> 'opening_stock' then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;

    select * into v_balance
    from public.inventory_balances as balance
    where balance.product_id = v_existing.product_id
      and balance.location_id = v_existing.location_id;

    return query select
      v_existing.id,
      v_balance.on_hand,
      v_balance.reserved,
      v_balance.on_hand - v_balance.reserved,
      v_balance.weighted_average_cost;
    return;
  end if;

  select * into v_balance
  from public.inventory_balances as balance
  where balance.product_id = p_product_id
    and balance.location_id = p_location_id
  for update;

  if not found then
    raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new_on_hand := v_balance.on_hand + p_quantity;

  if p_inbound_unit_cost is null then
    v_new_wac := null;
  elsif v_balance.on_hand = 0 then
    v_new_wac := p_inbound_unit_cost;
  elsif v_balance.weighted_average_cost is null then
    v_new_wac := null;
  else
    v_new_wac := (
      (v_balance.on_hand * v_balance.weighted_average_cost)
      + (p_quantity * p_inbound_unit_cost)
    ) / v_new_on_hand;
  end if;

  insert into public.inventory_movements (
    request_id,
    product_id,
    used_tyre_unit_id,
    location_id,
    quantity_delta,
    movement_type,
    reason,
    source_type,
    source_id,
    supplier_name,
    inbound_unit_cost,
    cost_snapshot,
    actor_user_id
  )
  values (
    p_request_id,
    p_product_id,
    null,
    p_location_id,
    p_quantity,
    'opening_stock',
    'Opening stock',
    nullif(btrim(coalesce(p_source_type, '')), ''),
    nullif(btrim(coalesce(p_source_id, '')), ''),
    null,
    p_inbound_unit_cost,
    v_new_wac,
    v_actor
  )
  returning id into v_movement_id;

  update public.inventory_balances
  set on_hand = v_new_on_hand,
      weighted_average_cost = v_new_wac,
      updated_at = now()
  where product_id = p_product_id
    and location_id = p_location_id;

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
    p_location_id,
    'OPENING_STOCK_POSTED',
    'inventory_movement',
    v_movement_id::text,
    jsonb_build_object(
      'product_id', p_product_id,
      'quantity', p_quantity,
      'unit_cost', p_inbound_unit_cost,
      'source_type', nullif(btrim(coalesce(p_source_type, '')), ''),
      'source_id', nullif(btrim(coalesce(p_source_id, '')), ''),
      'on_hand_before', v_balance.on_hand,
      'on_hand_after', v_new_on_hand
    )
  );

  return query select
    v_movement_id,
    v_new_on_hand,
    v_balance.reserved,
    v_new_on_hand - v_balance.reserved,
    v_new_wac;
end;
$$;

revoke execute on function public.post_opening_stock(
  uuid, uuid, uuid, integer, numeric, text, text
) from public, anon, service_role;
grant execute on function public.post_opening_stock(
  uuid, uuid, uuid, integer, numeric, text, text
) to authenticated;

-- Keep purchasing and opening stock out of the generic stock-movement surface.
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
begin
  if p_movement_type = 'purchase_receipt' then
    raise exception 'PURCHASE_RECEIPT_REQUIRES_PURCHASE_ORDER' using errcode = '42501';
  end if;
  if p_movement_type = 'opening_stock' then
    raise exception 'OPENING_STOCK_REQUIRES_IMPORT_PATH' using errcode = '42501';
  end if;

  return query select * from private.post_inventory_movement(
    p_request_id,
    p_product_id,
    p_location_id,
    p_quantity_delta,
    p_movement_type,
    p_reason,
    p_inbound_unit_cost,
    p_used_tyre_unit_id,
    p_source_type,
    p_source_id,
    p_supplier_name
  );
end;
$$;

revoke execute on function public.post_inventory_movement(
  uuid, uuid, uuid, integer, text, text, numeric, uuid, text, text, text
) from public, anon, service_role;
grant execute on function public.post_inventory_movement(
  uuid, uuid, uuid, integer, text, text, numeric, uuid, text, text, text
) to authenticated;
