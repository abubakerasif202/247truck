-- Hardens public.create_used_tyre_unit_with_stock against a concurrent
-- replay of the same idempotency key: two simultaneous submissions sharing
-- one request_id (e.g. a double-clicked intake form) could each pass the
-- unlocked replay check, insert two used_tyre_units rows, and have the
-- second's post_inventory_movement insert silently absorbed as an
-- "idempotent" unique_violation on request_id — leaving an orphan
-- available unit with no backing stock movement. Every other write path in
-- this ledger (post_opening_stock, stock movement notes, transfers) takes an
-- advisory lock keyed on actor+location+request before examining replay
-- state; this function never did. Add the same guard here.
--
-- Defence in depth: a partial unique index also makes it impossible for two
-- 'used_unit_in' movements to ever reference the same unit, even if some
-- future caller bypasses this function.

create unique index if not exists inventory_movements_used_unit_in_once_idx
  on public.inventory_movements (used_tyre_unit_id)
  where movement_type = 'used_unit_in';

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

  -- Serialize retries for the same actor + branch + request before examining
  -- replay state, so two concurrent submissions of the same idempotency key
  -- can never both pass the "no existing movement" check.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_location_id::text || ':' || p_request_id::text,
      0
    )
  );

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

revoke execute on function public.create_used_tyre_unit_with_stock(
  uuid, uuid, uuid, numeric, text, numeric, numeric, text
) from public, anon, service_role;
grant execute on function public.create_used_tyre_unit_with_stock(
  uuid, uuid, uuid, numeric, text, numeric, numeric, text
) to authenticated;
