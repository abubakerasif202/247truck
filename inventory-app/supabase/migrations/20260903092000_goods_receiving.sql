-- Phase 2A Task 5: atomic purchase-order receiving.
-- This migration extends the Phase 1 ledger and routes receipt stock through
-- public.post_inventory_movement so balance locking and WAC remain centralized.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (
    movement_type in (
      'quick_stock_in', 'stock_out', 'adjustment', 'used_unit_in',
      'used_unit_out', 'purchase_receipt'
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_direction_check;

alter table public.inventory_movements
  add constraint inventory_movements_direction_check check (
    (movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt')
      and quantity_delta > 0)
    or (movement_type in ('stock_out', 'used_unit_out') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );

create table public.goods_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null,
  purchase_order_id uuid not null references public.purchase_orders(id),
  location_id uuid not null references public.locations(id),
  supplier_id uuid not null references public.suppliers(id),
  receipt_number text not null unique,
  supplier_delivery_reference text,
  notes text,
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null default now(),
  unique (received_by, location_id, request_id)
);

create table public.goods_receipt_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id),
  product_id uuid not null references public.products(id),
  quantity_received integer not null check (quantity_received > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  inventory_movement_id uuid not null references public.inventory_movements(id),
  unique (goods_receipt_id, purchase_order_line_id),
  unique (inventory_movement_id)
);

create index goods_receipts_purchase_order_idx
  on public.goods_receipts (purchase_order_id, received_at desc);
create index goods_receipts_location_received_idx
  on public.goods_receipts (location_id, received_at desc);
create index goods_receipt_lines_purchase_order_line_idx
  on public.goods_receipt_lines (purchase_order_line_id);

alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
revoke all on public.goods_receipts from public, anon, authenticated, service_role;
revoke all on public.goods_receipt_lines from public, anon, authenticated, service_role;
grant select on public.goods_receipts to service_role;
grant select on public.goods_receipt_lines to service_role;

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

create or replace function public.receive_purchase_order(
  p_request_id uuid,
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_supplier_delivery_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
  v_po_location_id uuid;
  v_po public.purchase_orders%rowtype;
  v_existing public.goods_receipts%rowtype;
  v_receipt_id uuid := extensions.gen_random_uuid();
  v_receipt_number text;
  v_supplier_name text;
  v_input jsonb;
  v_line public.purchase_order_lines%rowtype;
  v_movement_id uuid;
  v_received integer;
  v_locked_count integer := 0;
  v_input_count integer;
begin
  if v_actor is null or p_request_id is null or p_purchase_order_id is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0 then
    raise exception 'RECEIPT_LINES_REQUIRED' using errcode = '22023';
  end if;

  -- Resolve the PO location before replay lookup so a replay cannot disclose
  -- another branch's receipt. Scope is checked before returning any result.
  select po.location_id into v_po_location_id
  from public.purchase_orders as po
  where po.id = p_purchase_order_id;
  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_role := private.assert_stock_authorization(v_po_location_id, 'purchase_receipt');

  select * into v_existing
  from public.goods_receipts as receipt
  where receipt.received_by = v_actor
    and receipt.location_id = v_po_location_id
    and receipt.request_id = p_request_id;
  if found then
    if v_existing.purchase_order_id <> p_purchase_order_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  -- The PO lock serializes all receiving attempts for the order. Recheck the
  -- replay key after waiting, because another request may have committed it.
  select * into v_po
  from public.purchase_orders as po
  where po.id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_role := private.assert_stock_authorization(v_po.location_id, 'purchase_receipt');

  select * into v_existing
  from public.goods_receipts as receipt
  where receipt.received_by = v_actor
    and receipt.location_id = v_po.location_id
    and receipt.request_id = p_request_id;
  if found then
    if v_existing.purchase_order_id <> p_purchase_order_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if v_po.status not in ('approved', 'sent', 'partially_received') then
    raise exception 'PO_NOT_RECEIVABLE' using errcode = '55000';
  end if;

  create temporary table pg_temp.receiving_input (
    purchase_order_line_id uuid primary key,
    quantity_received integer not null
  ) on commit drop;

  for v_input in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_received := (v_input ->> 'quantityReceived')::integer;
      if (v_input ->> 'purchaseOrderLineId') is null then
        raise exception 'invalid line';
      end if;
      insert into pg_temp.receiving_input (purchase_order_line_id, quantity_received)
      values ((v_input ->> 'purchaseOrderLineId')::uuid, v_received);
    exception when unique_violation then
      raise exception 'DUPLICATE_RECEIPT_LINE' using errcode = '23505';
    when others then
      if sqlstate = '23505' then
        raise exception 'DUPLICATE_RECEIPT_LINE' using errcode = '23505';
      end if;
      raise exception 'INVALID_RECEIPT_LINES' using errcode = '22023';
    end;
  end loop;

  if exists (select 1 from pg_temp.receiving_input where quantity_received <= 0) then
    raise exception 'INVALID_RECEIPT_QUANTITY' using errcode = '22023';
  end if;

  select count(*) into v_input_count from pg_temp.receiving_input;

  -- Lock selected lines in deterministic UUID order and reject foreign IDs.
  for v_line in
    select line.*
    from public.purchase_order_lines as line
    join pg_temp.receiving_input as input
      on input.purchase_order_line_id = line.id
    where line.purchase_order_id = v_po.id
    order by line.id
    for update
  loop
    v_locked_count := v_locked_count + 1;
    select input.quantity_received into v_received
    from pg_temp.receiving_input as input
    where input.purchase_order_line_id = v_line.id;
    if v_received > v_line.ordered_quantity - v_line.received_quantity then
      raise exception 'RECEIPT_QUANTITY_EXCEEDS_OUTSTANDING' using errcode = '22023';
    end if;
  end loop;

  if v_locked_count <> v_input_count then
    raise exception 'RECEIPT_LINE_NOT_IN_PURCHASE_ORDER' using errcode = '22023';
  end if;

  select supplier.name into v_supplier_name
  from public.suppliers as supplier
  where supplier.id = v_po.supplier_id;
  if not found then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_receipt_number := private.next_location_document_number(
    v_po.location_id, 'goods_receipt', 'GRN'
  );
  insert into public.goods_receipts (
    id, request_id, purchase_order_id, location_id, supplier_id,
    receipt_number, supplier_delivery_reference, notes, received_by
  )
  values (
    v_receipt_id, p_request_id, v_po.id, v_po.location_id, v_po.supplier_id,
    v_receipt_number, nullif(btrim(p_supplier_delivery_reference), ''),
    nullif(btrim(p_notes), ''), v_actor
  );

  for v_line in
    select line.*
    from public.purchase_order_lines as line
    join pg_temp.receiving_input as input
      on input.purchase_order_line_id = line.id
    where line.purchase_order_id = v_po.id
    order by line.id
  loop
    select input.quantity_received into v_received
    from pg_temp.receiving_input as input
    where input.purchase_order_line_id = v_line.id;

    select movement.movement_id into v_movement_id
    from public.post_inventory_movement(
      extensions.gen_random_uuid(), v_line.product_id, v_po.location_id,
      v_received, 'purchase_receipt', 'Purchase order receipt', v_line.unit_cost,
      null, 'goods_receipt', v_receipt_id::text, v_supplier_name
    ) as movement;

    insert into public.goods_receipt_lines (
      goods_receipt_id, purchase_order_line_id, product_id,
      quantity_received, unit_cost, inventory_movement_id
    )
    values (
      v_receipt_id, v_line.id, v_line.product_id,
      v_received, v_line.unit_cost, v_movement_id
    );

    update public.purchase_order_lines
    set received_quantity = received_quantity + v_received
    where id = v_line.id
      and received_quantity + v_received <= ordered_quantity;
    if not found then
      raise exception 'RECEIPT_QUANTITY_EXCEEDS_OUTSTANDING' using errcode = '22023';
    end if;

    insert into public.product_suppliers (product_id, supplier_id, last_cost)
    values (v_line.product_id, v_po.supplier_id, v_line.unit_cost)
    on conflict (product_id, supplier_id) do update
      set last_cost = excluded.last_cost;
  end loop;

  if exists (
    select 1 from public.purchase_order_lines as line
    where line.purchase_order_id = v_po.id
      and line.received_quantity < line.ordered_quantity
  ) then
    update public.purchase_orders
    set status = 'partially_received', updated_at = now()
    where id = v_po.id;
    perform private.audit_purchase_order(
      v_po.id, v_po.location_id, 'PURCHASE_ORDER_PARTIALLY_RECEIVED',
      jsonb_build_object('receipt_id', v_receipt_id, 'receipt_number', v_receipt_number)
    );
  else
    update public.purchase_orders
    set status = 'received', updated_at = now()
    where id = v_po.id;
    perform private.audit_purchase_order(
      v_po.id, v_po.location_id, 'PURCHASE_ORDER_RECEIVED',
      jsonb_build_object('receipt_id', v_receipt_id, 'receipt_number', v_receipt_number)
    );
  end if;

  return v_receipt_id;
end;
$$;

revoke execute on function public.receive_purchase_order(uuid, uuid, jsonb, text, text)
  from public, anon, service_role;
grant execute on function public.receive_purchase_order(uuid, uuid, jsonb, text, text)
  to authenticated;

-- The Phase 1 function is replaced here as well as in the source migration so
-- this incremental migration upgrades an already-migrated database. The
-- implementation remains the single ledger/WAC path for every stock change.
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
returns table (movement_id uuid, on_hand integer, reserved integer, available integer, weighted_average_cost numeric)
language plpgsql security definer set search_path = ''
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
  if (p_movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt') and p_quantity_delta <= 0)
    or (p_movement_type in ('stock_out', 'used_unit_out') and p_quantity_delta >= 0) then
    raise exception 'INVALID_MOVEMENT_DIRECTION' using errcode = '22023';
  end if;

  v_role := private.assert_stock_authorization(p_location_id, p_movement_type);
  select * into v_existing from public.inventory_movements
  where request_id = p_request_id and actor_user_id = v_actor and location_id = p_location_id;
  if found then
    if v_existing.product_id <> p_product_id or v_existing.movement_type <> p_movement_type then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select * into v_balance from public.inventory_balances
    where product_id = v_existing.product_id and location_id = v_existing.location_id;
    return query select v_existing.id, v_balance.on_hand, v_balance.reserved,
      v_balance.on_hand - v_balance.reserved,
      case when private.app_has_permission('inventory.view_cost') then v_balance.weighted_average_cost end;
    return;
  end if;

  select * into v_balance from public.inventory_balances
  where product_id = p_product_id and location_id = p_location_id for update;
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
    v_new_wac := ((v_balance.on_hand * v_balance.weighted_average_cost)
      + (p_quantity_delta * p_inbound_unit_cost)) / v_new_on_hand;
  end if;
  if p_movement_type = 'adjustment' and trim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;

  begin
    insert into public.inventory_movements (
      request_id, product_id, used_tyre_unit_id, location_id, quantity_delta,
      movement_type, reason, source_type, source_id, supplier_name, inbound_unit_cost,
      cost_snapshot, actor_user_id
    ) values (
      p_request_id, p_product_id, p_used_tyre_unit_id, p_location_id, p_quantity_delta,
      p_movement_type, nullif(trim(coalesce(p_reason, '')), ''), p_source_type, p_source_id,
      nullif(trim(coalesce(p_supplier_name, '')), ''),
      case when p_quantity_delta > 0 then p_inbound_unit_cost else null end,
      v_new_wac, v_actor
    ) returning id into v_movement_id;
  exception when unique_violation then
    select * into v_existing from public.inventory_movements
    where request_id = p_request_id and actor_user_id = v_actor and location_id = p_location_id;
    if not found then raise; end if;
    if v_existing.product_id <> p_product_id or v_existing.movement_type <> p_movement_type then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    select * into v_balance from public.inventory_balances
    where product_id = v_existing.product_id and location_id = v_existing.location_id;
    return query select v_existing.id, v_balance.on_hand, v_balance.reserved,
      v_balance.on_hand - v_balance.reserved,
      case when private.app_has_permission('inventory.view_cost') then v_balance.weighted_average_cost end;
    return;
  end;

  update public.inventory_balances set on_hand = v_new_on_hand,
    weighted_average_cost = v_new_wac, updated_at = now()
  where product_id = p_product_id and location_id = p_location_id;
  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details
  ) values (
    v_actor, v_role, p_location_id,
    case p_movement_type when 'adjustment' then 'INVENTORY_ADJUSTED'
      when 'stock_out' then 'STOCK_OUT' when 'used_unit_out' then 'STOCK_OUT' else 'STOCK_IN' end,
    'inventory_movement', v_movement_id::text,
    jsonb_build_object('product_id', p_product_id, 'quantity_delta', p_quantity_delta,
      'movement_type', p_movement_type, 'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'on_hand_before', v_balance.on_hand, 'on_hand_after', v_new_on_hand)
  );
  return query select v_movement_id, v_new_on_hand, v_balance.reserved,
    v_new_on_hand - v_balance.reserved,
    case when private.app_has_permission('inventory.view_cost') then v_new_wac end;
end;
$$;
