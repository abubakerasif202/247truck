-- Location-safe inventory summary view + Admin reorder-threshold RPC.
-- Depends on the identity, catalogue, and ledger migrations.

-- This is a security-definer, security-barrier view because its permitted
-- columns include WAC while authenticated callers intentionally have no
-- base-table WAC privilege. Scope is enforced here (rather than inherited
-- RLS), and the cost column is separately permission-gated below.
create view public.inventory_product_summary
with (security_barrier = true)
as
select
  p.id as product_id,
  p.name,
  p.category_code,
  p.part_reference,
  p.selling_price_incl_gst,
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
  (b.on_hand - b.reserved) as available,
  -- WAC is null unless the caller holds inventory.view_cost. The permission
  -- helper reads auth.uid(), so it is evaluated for the requesting user even
  -- though this approved view owns the base-table WAC access.
  case
    when (select private.app_has_permission('inventory.view_cost'))
    then b.weighted_average_cost
  end as weighted_average_cost,
  coalesce(s.minimum_stock, 0) as minimum_stock,
  coalesce(s.reorder_quantity, 0) as reorder_quantity,
  ((b.on_hand - b.reserved) < coalesce(s.minimum_stock, 0)) as low_stock
from public.products as p
join public.inventory_balances as b on b.product_id = p.id
join public.locations as l on l.id = b.location_id
left join public.inventory_settings as s
  on s.product_id = p.id and s.location_id = b.location_id
left join public.tyre_brands as tb on tb.id = p.tyre_brand_id
left join public.tyre_patterns as tp on tp.id = p.tyre_pattern_id
left join public.tyre_sizes as ts on ts.id = p.tyre_size_id
where
  (select private.app_is_admin())
  or b.location_id = (select private.app_user_location_id());

revoke all on public.inventory_product_summary from public, anon;
grant select on public.inventory_product_summary to authenticated;

-- Total inventory value for the caller's scope. Gated on
-- reports.view_inventory_value so the dashboard never needs raw per-row WAC.
create or replace function public.inventory_value_for_scope(
  p_location_code text default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value numeric;
begin
  if not private.app_has_permission('reports.view_inventory_value')
    or not private.app_has_permission('inventory.view_cost') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  select coalesce(sum(b.on_hand * b.weighted_average_cost), 0)
  into v_value
  from public.inventory_balances as b
  join public.products as p on p.id = b.product_id and p.active
  join public.locations as l on l.id = b.location_id
  where (p_location_code is null or l.code = p_location_code)
    and (
      (select private.app_is_admin())
      or b.location_id = (select private.app_user_location_id())
    );

  return v_value;
end;
$$;

revoke execute on function public.inventory_value_for_scope(text)
  from public, anon, service_role;
grant execute on function public.inventory_value_for_scope(text) to authenticated;

-- Recent movement lookup helper for the dashboard (RLS-scoped via the base table).
create index if not exists inventory_movements_created_idx
  on public.inventory_movements (created_at desc);

-- Admin reorder thresholds --------------------------------------------------

create or replace function public.set_reorder_settings(
  p_product_id uuid,
  p_location_code text,
  p_minimum_stock integer,
  p_reorder_quantity integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_location_id uuid;
begin
  if not (select private.app_is_admin()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_minimum_stock is null or p_minimum_stock < 0
    or p_reorder_quantity is null or p_reorder_quantity < 0 then
    raise exception 'INVALID_SETTINGS' using errcode = '22023';
  end if;

  select id into v_location_id
  from public.locations where code = p_location_code and active;
  if not found then
    raise exception 'LOCATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.inventory_settings (
    product_id, location_id, minimum_stock, reorder_quantity
  )
  values (p_product_id, v_location_id, p_minimum_stock, p_reorder_quantity)
  on conflict (product_id, location_id) do update
    set minimum_stock = excluded.minimum_stock,
        reorder_quantity = excluded.reorder_quantity,
        updated_at = now();

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details
  )
  values (
    v_actor, 'admin', v_location_id, 'REORDER_SETTINGS_UPDATED', 'product',
    p_product_id::text,
    jsonb_build_object(
      'location_code', p_location_code,
      'minimum_stock', p_minimum_stock,
      'reorder_quantity', p_reorder_quantity
    )
  );
end;
$$;

revoke execute on function public.set_reorder_settings(uuid, text, integer, integer)
  from public, anon, service_role;
grant execute on function public.set_reorder_settings(uuid, text, integer, integer)
  to authenticated;
