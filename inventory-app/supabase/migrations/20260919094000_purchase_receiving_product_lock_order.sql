-- receive_purchase_order locked purchase_order_lines `order by line.id` in
-- both the validation loop and the posting loop. line.id is
-- gen_random_uuid(), uncorrelated with product_id, and purchase_order_lines
-- has no uniqueness constraint preventing two open purchase orders at one
-- branch from both containing the same two products. Two such POs received
-- concurrently, with their line ids sorting in opposite order, lock the
-- underlying per-product balance rows (inside post_inventory_movement) in
-- opposite order too -> classic deadlock, surfaced to the receiving Manager
-- as an opaque "Could not receive the purchase order."
--
-- 20260914184148_complete_job_lock_order_and_replay_actor.sql already hit
-- this exact bug class for complete_job and fixed it by locking `order by
-- product_id`. This migration applies the same convention here. This is a
-- like-for-like function body restore with only the two ORDER BY clauses
-- changed -- no other behavior changes.
create or replace function public.receive_purchase_order(
  p_request_id uuid, p_purchase_order_id uuid, p_lines jsonb,
  p_supplier_delivery_reference text default null, p_notes text default null
)
returns uuid
language plpgsql security definer set search_path = ''
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
  select po.location_id into v_po_location_id from public.purchase_orders as po
  where po.id = p_purchase_order_id;
  if not found then raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_role := private.assert_stock_authorization(v_po_location_id, 'purchase_receipt');
  select * into v_existing from public.goods_receipts as receipt
  where receipt.received_by = v_actor and receipt.location_id = v_po_location_id
    and receipt.request_id = p_request_id;
  if found then
    if v_existing.purchase_order_id <> p_purchase_order_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  select * into v_po from public.purchase_orders as po where po.id = p_purchase_order_id for update;
  if not found then raise exception 'PURCHASE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_role := private.assert_stock_authorization(v_po.location_id, 'purchase_receipt');
  select * into v_existing from public.goods_receipts as receipt
  where receipt.received_by = v_actor and receipt.location_id = v_po.location_id
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
    purchase_order_line_id uuid primary key, quantity_received integer not null
  ) on commit drop;
  for v_input in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_received := (v_input ->> 'quantityReceived')::integer;
      if (v_input ->> 'purchaseOrderLineId') is null then raise exception 'invalid line'; end if;
      insert into pg_temp.receiving_input (purchase_order_line_id, quantity_received)
      values ((v_input ->> 'purchaseOrderLineId')::uuid, v_received);
    exception when unique_violation then
      raise exception 'DUPLICATE_RECEIPT_LINE' using errcode = '23505';
    when others then
      if sqlstate = '23505' then raise exception 'DUPLICATE_RECEIPT_LINE' using errcode = '23505'; end if;
      raise exception 'INVALID_RECEIPT_LINES' using errcode = '22023';
    end;
  end loop;
  if exists (select 1 from pg_temp.receiving_input where quantity_received <= 0) then
    raise exception 'INVALID_RECEIPT_QUANTITY' using errcode = '22023';
  end if;
  select count(*) into v_input_count from pg_temp.receiving_input;
  for v_line in
    select line.* from public.purchase_order_lines as line
    join pg_temp.receiving_input as input on input.purchase_order_line_id = line.id
    where line.purchase_order_id = v_po.id order by line.product_id, line.id for update
  loop
    v_locked_count := v_locked_count + 1;
    select input.quantity_received into v_received from pg_temp.receiving_input as input
    where input.purchase_order_line_id = v_line.id;
    if v_received > v_line.ordered_quantity - v_line.received_quantity then
      raise exception 'RECEIPT_QUANTITY_EXCEEDS_OUTSTANDING' using errcode = '22023';
    end if;
  end loop;
  if v_locked_count <> v_input_count then
    raise exception 'RECEIPT_LINE_NOT_IN_PURCHASE_ORDER' using errcode = '22023';
  end if;
  select supplier.name into v_supplier_name from public.suppliers as supplier where supplier.id = v_po.supplier_id;
  if not found then raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0002'; end if;

  v_receipt_number := private.next_location_document_number(v_po.location_id, 'goods_receipt', 'GRN');
  insert into public.goods_receipts (
    id, request_id, purchase_order_id, location_id, supplier_id, receipt_number,
    supplier_delivery_reference, notes, received_by
  ) values (
    v_receipt_id, p_request_id, v_po.id, v_po.location_id, v_po.supplier_id, v_receipt_number,
    nullif(btrim(p_supplier_delivery_reference), ''), nullif(btrim(p_notes), ''), v_actor
  );
  for v_line in
    select line.* from public.purchase_order_lines as line
    join pg_temp.receiving_input as input on input.purchase_order_line_id = line.id
    where line.purchase_order_id = v_po.id order by line.product_id, line.id
  loop
    select input.quantity_received into v_received from pg_temp.receiving_input as input
    where input.purchase_order_line_id = v_line.id;
    select movement.movement_id into v_movement_id
    from private.post_purchase_receipt_movement(
      extensions.gen_random_uuid(), v_line.product_id, v_po.location_id, v_received,
      'Purchase order receipt', v_line.unit_cost, 'goods_receipt', v_receipt_id::text,
      v_supplier_name
    ) as movement;
    insert into public.goods_receipt_lines (
      goods_receipt_id, purchase_order_line_id, product_id, quantity_received, unit_cost, inventory_movement_id
    ) values (v_receipt_id, v_line.id, v_line.product_id, v_received, v_line.unit_cost, v_movement_id);
    update public.purchase_order_lines set received_quantity = received_quantity + v_received
    where id = v_line.id and received_quantity + v_received <= ordered_quantity;
    if not found then raise exception 'RECEIPT_QUANTITY_EXCEEDS_OUTSTANDING' using errcode = '22023'; end if;
    insert into public.product_suppliers (product_id, supplier_id, last_cost)
    values (v_line.product_id, v_po.supplier_id, v_line.unit_cost)
    on conflict (product_id, supplier_id) do update set last_cost = excluded.last_cost;
  end loop;
  if exists (
    select 1 from public.purchase_order_lines as line
    where line.purchase_order_id = v_po.id and line.received_quantity < line.ordered_quantity
  ) then
    update public.purchase_orders set status = 'partially_received', updated_at = now() where id = v_po.id;
    perform private.audit_purchase_order(v_po.id, v_po.location_id, 'PURCHASE_ORDER_PARTIALLY_RECEIVED',
      jsonb_build_object('receipt_id', v_receipt_id, 'receipt_number', v_receipt_number));
  else
    update public.purchase_orders set status = 'received', updated_at = now() where id = v_po.id;
    perform private.audit_purchase_order(v_po.id, v_po.location_id, 'PURCHASE_ORDER_RECEIVED',
      jsonb_build_object('receipt_id', v_receipt_id, 'receipt_number', v_receipt_number));
  end if;
  return v_receipt_id;
end;
$$;
