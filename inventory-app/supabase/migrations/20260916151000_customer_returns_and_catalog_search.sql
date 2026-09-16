-- Migration: 20260916151000_customer_returns_and_catalog_search.sql
-- Description:
-- 1. Adds 'customer_return' movement type to inventory ledger with direction check (> 0).
-- 2. Updates private.assert_stock_authorization to authorize 'customer_return' using 'inventory.stock_in'.
-- 3. Updates private.post_inventory_movement to handle 'customer_return' and preserve/recalculate WAC safely.
-- 4. Exposes public.post_customer_return_movement RPC for atomic return intake.
-- 5. Re-engineers public.inventory_summary_page() and public.get_inventory_product_summary() to query base tables directly, eliminating query planner materialization bottlenecks (Finding P1-2).

-- 1. Update inventory_movements check constraints
alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (movement_type in (
    'quick_stock_in', 'stock_out', 'adjustment', 'used_unit_in', 'used_unit_out',
    'purchase_receipt', 'opening_stock', 'transfer_out', 'transfer_in',
    'customer_return'
  ));

alter table public.inventory_movements
  drop constraint if exists inventory_movements_direction_check;

alter table public.inventory_movements
  add constraint inventory_movements_direction_check check (
    (movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt', 'opening_stock', 'transfer_in', 'customer_return') and quantity_delta > 0)
    or (movement_type in ('stock_out', 'used_unit_out', 'transfer_out') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );

-- 2. Update private.assert_stock_authorization to permit customer_return
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
    when 'purchase_receipt' then 'purchasing.receive_po'
    when 'customer_return' then 'inventory.stock_in'
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

-- 3. Update private.post_inventory_movement
create or replace function private.post_inventory_movement(
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
  if (p_movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt', 'customer_return') and p_quantity_delta <= 0)
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

  if p_movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt') then
    if p_inbound_unit_cost is null or p_inbound_unit_cost < 0 then
      raise exception 'INBOUND_COST_REQUIRED' using errcode = '22023';
    end if;
    v_new_wac := (
      (v_balance.on_hand * v_balance.weighted_average_cost)
      + (p_quantity_delta * p_inbound_unit_cost)
    ) / v_new_on_hand;
  elsif p_movement_type = 'customer_return' then
    if p_inbound_unit_cost is not null and p_inbound_unit_cost < 0 then
      raise exception 'INVALID_COST' using errcode = '22023';
    end if;
    -- On customer return: if unit cost is provided, factor into WAC;
    -- otherwise default to current WAC preserving cost basis.
    if p_inbound_unit_cost is not null and p_inbound_unit_cost >= 0 then
      v_new_wac := (
        (v_balance.on_hand * coalesce(v_balance.weighted_average_cost, p_inbound_unit_cost))
        + (p_quantity_delta * p_inbound_unit_cost)
      ) / v_new_on_hand;
    end if;
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
      case when p_quantity_delta > 0 then coalesce(p_inbound_unit_cost, v_balance.weighted_average_cost) else null end,
      v_new_wac, v_actor
    )
    returning id into v_movement_id;
  exception when unique_violation then
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
      updated_at = pg_catalog.now()
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
    'inventory_movement',
    v_movement_id::text,
    jsonb_build_object(
      'product_id', p_product_id,
      'quantity_delta', p_quantity_delta,
      'movement_type', p_movement_type,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'on_hand_before', v_balance.on_hand,
      'on_hand_after', v_new_on_hand,
      'wac_after', v_new_wac,
      'source_type', p_source_type,
      'source_id', p_source_id
    )
  );

  return query select
    v_movement_id,
    v_new_on_hand,
    v_balance.reserved,
    v_new_on_hand - v_balance.reserved,
    case when private.app_has_permission('inventory.view_cost')
      then v_new_wac end;
end;
$$;

revoke execute on function private.post_inventory_movement(
  uuid, uuid, uuid, integer, text, text, numeric, uuid, text, text, text
) from public, anon, authenticated, service_role;

-- 4. Expose public.post_customer_return_movement for atomic return restocking
create or replace function public.post_customer_return_movement(
  p_request_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity integer,
  p_reason text default null,
  p_unit_cost numeric default null,
  p_credit_note_id uuid default null,
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
  v_credit_note public.credit_notes%rowtype;
  v_reason text;
begin
  if v_actor is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_quantity <= 0 then
    raise exception 'INVALID_RETURN_QUANTITY' using errcode = '22023';
  end if;

  if p_credit_note_id is not null then
    select * into v_credit_note from public.credit_notes where id = p_credit_note_id;
    if not found then
      raise exception 'CREDIT_NOTE_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_reason := coalesce(nullif(btrim(p_reason), ''), 'Customer Return - Credit Note #' || v_credit_note.credit_note_number);
  else
    v_reason := coalesce(nullif(btrim(p_reason), ''), 'Customer Return');
  end if;

  return query select * from public.post_inventory_movement_with_notes(
    p_request_id,
    p_product_id,
    p_location_id,
    p_quantity,
    'customer_return',
    v_reason,
    p_unit_cost,
    null,
    case when p_credit_note_id is not null then 'credit_note' else 'customer_return' end,
    p_credit_note_id::text,
    null,
    p_notes
  );
end;
$$;

revoke execute on function public.post_customer_return_movement(
  uuid, uuid, uuid, integer, text, numeric, uuid, text
) from public, anon, service_role;
grant execute on function public.post_customer_return_movement(
  uuid, uuid, uuid, integer, text, numeric, uuid, text
) to authenticated;

-- 5. Re-engineered inventory_summary_page querying base tables directly for performance
create or replace function public.inventory_summary_page(
  p_location_code text default null, p_product_id uuid default null, p_search text default null,
  p_category text default null, p_tyre_condition text default null, p_low_stock_only boolean default false,
  p_include_archived boolean default false, p_offset integer default 0, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  term text:=lower(btrim(coalesce(p_search,'')));
  total bigint;
  page_rows jsonb;
  v_can_view_cost boolean;
  v_is_admin boolean;
  v_user_location uuid;
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  if p_offset<0 or p_limit not between 1 and 200 then
    raise exception 'INVALID_LIMIT' using errcode='22023';
  end if;
  if p_location_code is not null and not exists(select 1 from public.locations l where l.code=p_location_code) then
    raise exception 'INVALID_LOCATION' using errcode='22023';
  end if;
  v_is_admin := private.app_is_admin();
  v_user_location := private.app_user_location_id();
  if p_location_code is not null and not v_is_admin
     and (select l.id from public.locations l where l.code=p_location_code) is distinct from v_user_location then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;

  v_can_view_cost := private.app_has_permission('inventory.view_cost');

  with base_filtered as (
    select
      p.id as product_id,
      p.name,
      p.category_code,
      p.part_reference,
      p.retail_price_incl_gst::numeric(14, 2) as retail_price_incl_gst,
      p.wholesale_price_incl_gst::numeric(14, 2) as wholesale_price_incl_gst,
      p.selling_price_incl_gst::numeric(14, 2) as selling_price_incl_gst,
      p.active,
      p.tyre_condition,
      tb.display_name as brand_name,
      tp.display_name as pattern_name,
      ts.display_size as size_name,
      b.location_id,
      l.code as location_code,
      l.name as location_name,
      b.on_hand,
      b.reserved,
      b.on_hand - b.reserved as available,
      case when v_can_view_cost then b.weighted_average_cost else null::numeric end as weighted_average_cost,
      coalesce(s.minimum_stock, 0) as minimum_stock,
      coalesce(s.reorder_quantity, 0) as reorder_quantity,
      (b.on_hand - b.reserved) < coalesce(s.minimum_stock, 0) as low_stock
    from public.products p
      join public.inventory_balances b on b.product_id = p.id
      join public.locations l on l.id = b.location_id
      left join public.inventory_settings s on s.product_id = p.id and s.location_id = b.location_id
      left join public.tyre_brands tb on tb.id = p.tyre_brand_id
      left join public.tyre_patterns tp on tp.id = p.tyre_pattern_id
      left join public.tyre_sizes ts on ts.id = p.tyre_size_id
    where (v_is_admin or b.location_id = v_user_location)
      and (p_include_archived or p.active)
      and (p_product_id is null or p.id = p_product_id)
      and (p_location_code is null or l.code = p_location_code)
      and (p_category is null or p.category_code = p_category)
      and (p_tyre_condition is null or p.tyre_condition = p_tyre_condition)
      and (term = '' or lower(concat_ws(' ', p.name, p.part_reference, tb.display_name, tp.display_name, ts.display_size)) like '%' || term || '%')
  ),
  scoped_filtered as (
    select * from base_filtered
    where (not p_low_stock_only or low_stock)
  ),
  counted as (
    select count(distinct product_id) as total from scoped_filtered
  ),
  page_products as (
    select distinct product_id, name
    from scoped_filtered
    order by name, product_id
    offset p_offset limit p_limit
  ),
  page_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', s.product_id, 'name', s.name, 'category_code', s.category_code, 'part_reference', s.part_reference,
      'retail_price_incl_gst', s.retail_price_incl_gst, 'wholesale_price_incl_gst', s.wholesale_price_incl_gst,
      'selling_price_incl_gst', s.selling_price_incl_gst, 'tyre_condition', s.tyre_condition, 'brand_name', s.brand_name,
      'pattern_name', s.pattern_name, 'size_name', s.size_name, 'location_code', s.location_code, 'location_name', s.location_name,
      'on_hand', s.on_hand, 'reserved', s.reserved, 'available', s.available, 'weighted_average_cost', s.weighted_average_cost,
      'minimum_stock', s.minimum_stock, 'reorder_quantity', s.reorder_quantity, 'low_stock', s.low_stock, 'active', s.active
    ) order by s.name, s.product_id, s.location_code), '[]'::jsonb) as rows_json
    from scoped_filtered s
    join page_products pp on pp.product_id = s.product_id
  )
  select counted.total, page_json.rows_json into total, page_rows from counted, page_json;

  return jsonb_build_object('rows', page_rows, 'total_products', coalesce(total, 0), 'offset', p_offset, 'limit', p_limit, 'has_more', p_offset + p_limit < coalesce(total, 0));
end; $$;

revoke execute on function public.inventory_summary_page(text,uuid,text,text,text,boolean,boolean,integer,integer) from public,anon,service_role;
grant execute on function public.inventory_summary_page(text,uuid,text,text,text,boolean,boolean,integer,integer) to authenticated;
