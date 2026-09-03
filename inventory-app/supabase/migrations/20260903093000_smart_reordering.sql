-- Phase 2A Task 7: location-specific reorder settings, safe suggestions, and
-- explicit supplier-grouped draft PO generation.

-- Reorder settings -----------------------------------------------------------

create or replace function public.set_inventory_reorder_settings(
  p_product_id uuid,
  p_location_id uuid,
  p_minimum_stock integer,
  p_reorder_quantity integer,
  p_preferred_supplier_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  perform private.assert_purchase_order_scope(p_location_id, 'purchasing.create_po');

  if p_minimum_stock is null or p_minimum_stock < 0
    or p_reorder_quantity is null or p_reorder_quantity < 0 then
    raise exception 'INVALID_SETTINGS' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.locations as location
    where location.id = p_location_id and location.active
  ) then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.products as product
    where product.id = p_product_id and product.active
  ) then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_preferred_supplier_id is not null then
    if not exists (
      select 1
      from public.suppliers as supplier
      where supplier.id = p_preferred_supplier_id and supplier.active
    ) then
      raise exception 'SUPPLIER_INACTIVE' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.product_suppliers as link
      where link.product_id = p_product_id
        and link.supplier_id = p_preferred_supplier_id
    ) then
      raise exception 'SUPPLIER_NOT_ASSOCIATED' using errcode = '22023';
    end if;
  end if;

  select profile.role
  into v_role
  from public.user_profiles as profile
  where profile.user_id = v_actor and profile.active;

  insert into public.inventory_settings (
    product_id, location_id, minimum_stock, reorder_quantity,
    preferred_supplier_id
  )
  values (
    p_product_id, p_location_id, p_minimum_stock, p_reorder_quantity,
    p_preferred_supplier_id
  )
  on conflict (product_id, location_id) do update
    set minimum_stock = excluded.minimum_stock,
        reorder_quantity = excluded.reorder_quantity,
        preferred_supplier_id = excluded.preferred_supplier_id,
        updated_at = now();

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type,
    entity_type, entity_id, details
  )
  values (
    v_actor, v_role, p_location_id, 'REORDER_SETTINGS_UPDATED',
    'product', p_product_id::text,
    jsonb_build_object(
      'minimum_stock', p_minimum_stock,
      'reorder_quantity', p_reorder_quantity,
      'preferred_supplier_id', p_preferred_supplier_id
    )
  );
end;
$$;

revoke execute on function public.set_inventory_reorder_settings(uuid, uuid, integer, integer, uuid)
  from public, anon, service_role;
grant execute on function public.set_inventory_reorder_settings(uuid, uuid, integer, integer, uuid)
  to authenticated;

-- Cost-free suggestion projection -------------------------------------------

create or replace function public.reorder_suggestions(
  p_location_id uuid default null
)
returns table (
  product_id uuid,
  product_name text,
  location_code text,
  available integer,
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
  where (v_location_id is null or summary.location_id = v_location_id)
    and summary.available < summary.minimum_stock
    and summary.reorder_quantity > 0
  order by summary.location_code, summary.name, summary.product_id;
end;
$$;

revoke execute on function public.reorder_suggestions(uuid)
  from public, anon, service_role;
grant execute on function public.reorder_suggestions(uuid) to authenticated;

-- Explicit draft generation --------------------------------------------------

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
    if v_available >= coalesce(v_minimum_stock, 0)
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

revoke execute on function public.create_draft_purchase_orders_from_reorder(uuid, uuid[])
  from public, anon, service_role;
grant execute on function public.create_draft_purchase_orders_from_reorder(uuid, uuid[])
  to authenticated;
