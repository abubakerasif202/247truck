-- reorder_suggestions and create_draft_purchase_orders_from_reorder both
-- compared `available` against `minimum_stock` with no regard for purchase
-- orders already raised for the shortfall. A product with an
-- approved-but-unreceived PO kept reappearing as a suggestion every day
-- until goods physically landed, and staff could generate a second draft PO
-- for the same shortage before the first one arrived -- create_draft_purchase_orders_from_reorder
-- re-checks the identical eligibility predicate, so it offered no protection
-- either. Both now compare `available + on_order` against `minimum_stock`,
-- where on_order = sum(ordered_quantity - received_quantity) across this
-- product's lines on purchase orders in ('approved','sent','partially_received')
-- at the same location. reorder_suggestions also now returns on_order so the
-- UI can show it.
-- Adding a column to a RETURNS TABLE changes the function's return type,
-- which CREATE OR REPLACE FUNCTION cannot do -- drop it first.
drop function if exists public.reorder_suggestions(uuid);

create function public.reorder_suggestions(
  p_location_id uuid default null
)
returns table (
  product_id uuid,
  product_name text,
  location_code text,
  available integer,
  on_order integer,
  minimum_stock integer,
  reorder_quantity integer,
  preferred_supplier_id uuid,
  preferred_supplier_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location_id uuid := p_location_id;
begin
  if not (select private.app_has_permission('purchasing.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  if not (select private.app_is_admin()) then
    v_location_id := (select private.app_user_location_id());
    if p_location_id is not null
      and p_location_id is distinct from v_location_id then
      raise exception 'ACCESS_DENIED' using errcode = '42501';
    end if;
  elsif p_location_id is not null and not exists (
    select 1 from public.locations as location
    where location.id = p_location_id and location.active
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
  select
    summary.product_id,
    summary.name,
    summary.location_code,
    summary.available,
    coalesce(on_order.quantity, 0)::integer,
    summary.minimum_stock,
    summary.reorder_quantity,
    settings.preferred_supplier_id,
    supplier.name
  from public.inventory_product_summary as summary
  left join public.inventory_settings as settings
    on settings.product_id = summary.product_id
   and settings.location_id = summary.location_id
  left join public.suppliers as supplier
    on supplier.id = settings.preferred_supplier_id
   and supplier.active
  left join lateral (
    select sum(line.ordered_quantity - line.received_quantity)::integer as quantity
    from public.purchase_order_lines as line
    join public.purchase_orders as po on po.id = line.purchase_order_id
    where line.product_id = summary.product_id
      and po.location_id = summary.location_id
      and po.status in ('approved', 'sent', 'partially_received')
  ) as on_order on true
  where (v_location_id is null or summary.location_id = v_location_id)
    and (summary.available + coalesce(on_order.quantity, 0)) < summary.minimum_stock
    and summary.reorder_quantity > 0
  order by summary.location_code, summary.name, summary.product_id;
end;
$$;

create or replace function public.create_draft_purchase_orders_from_reorder(
  p_location_id uuid,
  p_product_ids uuid[]
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_product_id uuid;
  v_supplier_id uuid;
  v_supplier_name text;
  v_product_name text;
  v_supplier_sku text;
  v_unit_cost numeric(14, 4);
  v_minimum_order_qty integer;
  v_available integer;
  v_on_order integer;
  v_minimum_stock integer;
  v_reorder_quantity integer;
  v_po_id uuid;
  v_po_number text;
begin
  perform private.assert_purchase_order_scope(p_location_id, 'purchasing.create_po');

  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'REORDER_SELECTION_REQUIRED' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.locations as location
    where location.id = p_location_id and location.active
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Lock all selected balances in deterministic product order before reading
  -- eligibility. This prevents a concurrent stock mutation from making a
  -- stale suggestion eligible during generation.
  for v_product_id in
    select distinct selected_product
    from unnest(p_product_ids) as selected(selected_product)
    where selected_product is not null
    order by selected_product
  loop
    perform 1
    from public.inventory_balances as balance
    where balance.product_id = v_product_id
      and balance.location_id = p_location_id
    for update;

    if not found then
      raise exception 'PRODUCT_NOT_AVAILABLE_AT_LOCATION' using errcode = 'P0002';
    end if;
  end loop;

  -- Materialise normalized, validated rows so duplicate input IDs can never
  -- create duplicate PO lines and all validation completes before inserts.
  create temp table pg_temp.smart_reorder_lines (
    product_id uuid primary key,
    product_name text not null,
    supplier_id uuid not null,
    supplier_sku text,
    ordered_quantity integer not null,
    unit_cost numeric(14, 4) not null
  ) on commit drop;

  for v_product_id in
    select distinct selected_product
    from unnest(p_product_ids) as selected(selected_product)
    where selected_product is not null
    order by selected_product
  loop
    select
      product.name,
      balance.on_hand - balance.reserved,
      settings.minimum_stock,
      settings.reorder_quantity,
      settings.preferred_supplier_id
    into
      v_product_name,
      v_available,
      v_minimum_stock,
      v_reorder_quantity,
      v_supplier_id
    from public.products as product
    join public.inventory_balances as balance
      on balance.product_id = product.id
     and balance.location_id = p_location_id
    left join public.inventory_settings as settings
      on settings.product_id = product.id
     and settings.location_id = p_location_id
    where product.id = v_product_id and product.active;

    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;

    select coalesce(sum(line.ordered_quantity - line.received_quantity), 0)::integer
    into v_on_order
    from public.purchase_order_lines as line
    join public.purchase_orders as po on po.id = line.purchase_order_id
    where line.product_id = v_product_id
      and po.location_id = p_location_id
      and po.status in ('approved', 'sent', 'partially_received');

    if (v_available + v_on_order) >= coalesce(v_minimum_stock, 0)
      or coalesce(v_reorder_quantity, 0) <= 0 then
      raise exception 'REORDER_NOT_ELIGIBLE' using errcode = '22023';
    end if;
    if v_supplier_id is null then
      raise exception 'PREFERRED_SUPPLIER_REQUIRED' using errcode = '22023';
    end if;

    select
      supplier.name,
      link.supplier_sku,
      link.last_cost,
      link.minimum_order_qty
    into
      v_supplier_name,
      v_supplier_sku,
      v_unit_cost,
      v_minimum_order_qty
    from public.suppliers as supplier
    join public.product_suppliers as link
      on link.supplier_id = supplier.id
     and link.product_id = v_product_id
    where supplier.id = v_supplier_id and supplier.active;

    if not found then
      if exists (select 1 from public.suppliers where id = v_supplier_id) then
        raise exception 'SUPPLIER_INACTIVE' using errcode = '22023';
      end if;
      raise exception 'SUPPLIER_NOT_ASSOCIATED' using errcode = '22023';
    end if;
    if v_unit_cost is null then
      raise exception 'SUPPLIER_COST_REQUIRED' using errcode = '22023';
    end if;

    insert into pg_temp.smart_reorder_lines (
      product_id, product_name, supplier_id, supplier_sku,
      ordered_quantity, unit_cost
    )
    values (
      v_product_id, v_product_name, v_supplier_id, v_supplier_sku,
      greatest(v_reorder_quantity, v_minimum_order_qty), v_unit_cost
    );
  end loop;

  for v_supplier_id in
    select distinct lines.supplier_id
    from pg_temp.smart_reorder_lines as lines
    order by lines.supplier_id
  loop
    v_po_number := private.next_location_document_number(
      p_location_id, 'purchase_order', 'PO'
    );

    insert into public.purchase_orders (
      location_id, supplier_id, po_number, status, created_by
    )
    values (p_location_id, v_supplier_id, v_po_number, 'draft', v_actor)
    returning id into v_po_id;

    insert into public.purchase_order_lines (
      purchase_order_id, product_id, description_snapshot,
      supplier_sku_snapshot, ordered_quantity, unit_cost
    )
    select
      v_po_id, lines.product_id, lines.product_name,
      lines.supplier_sku, lines.ordered_quantity, lines.unit_cost
    from pg_temp.smart_reorder_lines as lines
    where lines.supplier_id = v_supplier_id
    order by lines.product_id;

    perform private.audit_purchase_order(
      v_po_id,
      p_location_id,
      'PURCHASE_ORDER_CREATED',
      jsonb_build_object(
        'po_number', v_po_number,
        'supplier_id', v_supplier_id,
        'source', 'smart_reorder'
      )
    );

    return next v_po_id;
  end loop;
end;
$$;

revoke execute on function public.reorder_suggestions(uuid)
  from public, anon, service_role;
grant execute on function public.reorder_suggestions(uuid) to authenticated;
