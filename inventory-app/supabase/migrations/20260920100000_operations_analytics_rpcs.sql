-- Phase 5: Operations Analytics read-only RPCs.
--
-- These are aggregate reporting queries only. They intentionally reuse the
-- authoritative sources already established by earlier phases rather than
-- recomputing business rules:
--   - stock on hand/available/low-stock/cost redaction: public.inventory_product_summary
--     (wraps private.inventory_product_summary(), which already nulls
--     weighted_average_cost without inventory.view_cost -- see
--     20260914185720_inventory_product_summary_security_invoker.sql).
--   - replenishment/reorder shortage math and double-order prevention:
--     public.reorder_suggestions (20260919095000) is NOT duplicated here.
--     The analytics/replenishment UI calls that existing RPC directly.
--   - known inventory value: public.inventory_value_for_scope (20260902093000)
--     is NOT duplicated here, but its double gate IS: an aggregate value total
--     requires reports.view_inventory_value AND inventory.view_cost, matching
--     lib/inventory/queries.ts getDashboardInventoryMetrics.canViewValuation.
--     inventory_product_summary only gates the per-row WAC column on
--     inventory.view_cost alone (a narrower, separately-grantable permission),
--     so summing that column without also checking reports.view_inventory_value
--     would let a manager with view_cost-but-not-view_inventory_value see an
--     aggregate total the dashboard deliberately withholds from them.
--   - open purchase order listing/receiving semantics:
--     public.purchase_orders.status: 'draft','submitted','approved','sent',
--     'partially_received','received','closed','rejected','cancelled'
--     (20260903091000). "Legitimate inbound" for outstanding-unit math is
--     ('approved','sent','partially_received'), matching reorder_suggestions.
--
-- Every RPC below follows the established shape: SECURITY DEFINER with an
-- empty search_path (never SECURITY INVOKER -- see 20260914185720 for why
-- INVOKER would require a raw column grant that leaks cost data), an
-- explicit auth.uid()/permission check first, then a location-scope check
-- that raises ACCESS_DENIED for a non-admin requesting another branch
-- (rather than silently returning zero rows), then revoke-from-public /
-- grant-to-authenticated at the end.

-- ---------------------------------------------------------------------------
-- 1. Inventory distribution by brand / size / category.
--
-- All three share the same shape: group public.inventory_product_summary
-- (already location-scoped and cost-redacted per caller) by the requested
-- dimension. known_inventory_value is a SUM over weighted_average_cost; when
-- the caller lacks inventory.view_cost the view already nulls that column
-- for every row, so SUM() naturally returns NULL (not 0) for the whole
-- group -- the same "unknown, not zero" signal the view uses per-row.
-- ---------------------------------------------------------------------------

create or replace function public.inventory_analytics_by_brand(
  p_location_code text default null
)
returns table (
  brand_name text,
  product_count bigint,
  on_hand bigint,
  available bigint,
  low_stock_count bigint,
  known_inventory_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code = p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    coalesce(s.brand_name, 'Unbranded') as brand_name,
    count(distinct s.product_id)::bigint as product_count,
    coalesce(sum(s.on_hand), 0)::bigint as on_hand,
    coalesce(sum(s.available), 0)::bigint as available,
    count(*) filter (where s.low_stock)::bigint as low_stock_count,
    case when (select private.app_has_permission('reports.view_inventory_value'))
      then sum(s.on_hand * s.weighted_average_cost)
    end as known_inventory_value
  from public.inventory_product_summary as s
  where s.active
    and (p_location_code is null or s.location_code = p_location_code)
  group by coalesce(s.brand_name, 'Unbranded')
  order by product_count desc, brand_name;
end;
$$;

create or replace function public.inventory_analytics_by_size(
  p_location_code text default null
)
returns table (
  size_name text,
  product_count bigint,
  on_hand bigint,
  available bigint,
  low_stock_count bigint,
  known_inventory_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code = p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    coalesce(s.size_name, 'Unspecified') as size_name,
    count(distinct s.product_id)::bigint as product_count,
    coalesce(sum(s.on_hand), 0)::bigint as on_hand,
    coalesce(sum(s.available), 0)::bigint as available,
    count(*) filter (where s.low_stock)::bigint as low_stock_count,
    case when (select private.app_has_permission('reports.view_inventory_value'))
      then sum(s.on_hand * s.weighted_average_cost)
    end as known_inventory_value
  from public.inventory_product_summary as s
  where s.active
    and (p_location_code is null or s.location_code = p_location_code)
  group by coalesce(s.size_name, 'Unspecified')
  order by product_count desc, size_name;
end;
$$;

create or replace function public.inventory_analytics_by_category(
  p_location_code text default null
)
returns table (
  category_code text,
  product_count bigint,
  on_hand bigint,
  available bigint,
  low_stock_count bigint,
  out_of_stock_count bigint,
  known_inventory_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code = p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    s.category_code,
    count(distinct s.product_id)::bigint as product_count,
    coalesce(sum(s.on_hand), 0)::bigint as on_hand,
    coalesce(sum(s.available), 0)::bigint as available,
    count(*) filter (where s.low_stock)::bigint as low_stock_count,
    count(*) filter (where s.available <= 0)::bigint as out_of_stock_count,
    case when (select private.app_has_permission('reports.view_inventory_value'))
      then sum(s.on_hand * s.weighted_average_cost)
    end as known_inventory_value
  from public.inventory_product_summary as s
  where s.active
    and (p_location_code is null or s.location_code = p_location_code)
  group by s.category_code
  order by product_count desc, s.category_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stock movement summary for a period. Reports each real movement_type
-- as recorded (quick_stock_in, stock_out, adjustment, used_unit_in,
-- used_unit_out) rather than inventing an "in/out/adjustment" bucket in SQL
-- -- the UI layer maps types to a display bucket so the mapping is visible
-- and can change without a migration.
-- ---------------------------------------------------------------------------

create or replace function public.stock_movement_summary(
  p_location_code text default null,
  p_days integer default 30
)
returns table (
  movement_type text,
  movement_count bigint,
  total_quantity bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code = p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    m.movement_type,
    count(*)::bigint as movement_count,
    coalesce(sum(m.quantity_delta), 0)::bigint as total_quantity
  from public.inventory_movements as m
  join public.locations as l on l.id = m.location_id
  where m.created_at >= now() - (p_days || ' days')::interval
    and (p_location_code is null or l.code = p_location_code)
    and ((select private.app_is_admin()) or m.location_id = (select private.app_user_location_id()))
  group by m.movement_type
  order by m.movement_type;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fast-moving products: ranks products by outward-movement quantity over
-- a period. This is a stock-movement metric, not a sales metric -- outward
-- movement_type covers stock_out and used_unit_out regardless of the
-- triggering source_type (POS, job completion, manual stock-out, transfer
-- out), so the UI must label this "fast-moving (stock movement)", never
-- "top selling".
-- ---------------------------------------------------------------------------

create or replace function public.fast_moving_products(
  p_location_code text default null,
  p_days integer default 30,
  p_limit integer default 20
)
returns table (
  product_id uuid,
  product_name text,
  brand_name text,
  size_name text,
  location_code text,
  quantity_moved bigint,
  movement_count bigint,
  on_hand integer,
  minimum_stock integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code = p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    p.id as product_id,
    p.name as product_name,
    tb.display_name as brand_name,
    ts.display_size as size_name,
    l.code as location_code,
    sum(abs(m.quantity_delta))::bigint as quantity_moved,
    count(*)::bigint as movement_count,
    b.on_hand,
    coalesce(iset.minimum_stock, 0) as minimum_stock
  from public.inventory_movements as m
  join public.products as p on p.id = m.product_id
  join public.locations as l on l.id = m.location_id
  join public.inventory_balances as b on b.product_id = p.id and b.location_id = m.location_id
  left join public.inventory_settings as iset on iset.product_id = p.id and iset.location_id = m.location_id
  left join public.tyre_brands tb on tb.id = p.tyre_brand_id
  left join public.tyre_sizes ts on ts.id = p.tyre_size_id
  where m.movement_type in ('stock_out', 'used_unit_out')
    and m.created_at >= now() - (p_days || ' days')::interval
    and p.active
    and (p_location_code is null or l.code = p_location_code)
    and ((select private.app_is_admin()) or m.location_id = (select private.app_user_location_id()))
  group by p.id, p.name, tb.display_name, ts.display_size, l.code, b.on_hand, iset.minimum_stock
  order by quantity_moved desc, p.name
  limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Slow-moving stock: products currently holding stock whose last outward
-- movement (all-time, not windowed) is either absent ("never moved") or
-- older than the selected inactivity window ("no movement during period").
-- These are returned as two distinguishable fields rather than one
-- collapsed label.
-- ---------------------------------------------------------------------------

create or replace function public.slow_moving_products(
  p_location_code text default null,
  p_days integer default 90
)
returns table (
  product_id uuid,
  product_name text,
  brand_name text,
  size_name text,
  location_code text,
  on_hand integer,
  last_outward_movement_at timestamptz,
  days_since_last_movement integer,
  never_moved boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code = p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    p.id as product_id,
    p.name as product_name,
    tb.display_name as brand_name,
    ts.display_size as size_name,
    l.code as location_code,
    b.on_hand,
    last_out.last_at as last_outward_movement_at,
    case when last_out.last_at is null then null
      else extract(day from now() - last_out.last_at)::integer end as days_since_last_movement,
    last_out.last_at is null as never_moved
  from public.inventory_balances as b
  join public.products as p on p.id = b.product_id
  join public.locations as l on l.id = b.location_id
  left join public.tyre_brands tb on tb.id = p.tyre_brand_id
  left join public.tyre_sizes ts on ts.id = p.tyre_size_id
  left join lateral (
    select max(m.created_at) as last_at
    from public.inventory_movements as m
    where m.product_id = p.id
      and m.location_id = b.location_id
      and m.movement_type in ('stock_out', 'used_unit_out')
  ) as last_out on true
  where p.active
    and b.on_hand > 0
    and (p_location_code is null or l.code = p_location_code)
    and ((select private.app_is_admin()) or b.location_id = (select private.app_user_location_id()))
    and (last_out.last_at is null or last_out.last_at < now() - (p_days || ' days')::interval)
  order by (last_out.last_at is null) desc, last_out.last_at asc nulls first, p.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Purchasing analytics summary: open PO count and outstanding inbound
-- units. Uses the exact same "legitimate inbound" status set as
-- reorder_suggestions (20260919095000) for outstanding_po_units so the two
-- features can never disagree about what counts as already-on-order.
-- ---------------------------------------------------------------------------

create or replace function public.purchasing_analytics_summary(
  p_location_id uuid default null
)
returns table (
  open_purchase_orders bigint,
  outstanding_po_units bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.app_has_permission('purchasing.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_location_id is not null and not (select private.app_is_admin())
     and p_location_id is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    (
      select count(*)::bigint
      from public.purchase_orders as po
      where po.status in ('submitted', 'approved', 'sent', 'partially_received')
        and (p_location_id is null or po.location_id = p_location_id)
        and ((select private.app_is_admin()) or po.location_id = (select private.app_user_location_id()))
    ) as open_purchase_orders,
    (
      select coalesce(sum(line.ordered_quantity - line.received_quantity), 0)::bigint
      from public.purchase_order_lines as line
      join public.purchase_orders as po on po.id = line.purchase_order_id
      where po.status in ('approved', 'sent', 'partially_received')
        and (p_location_id is null or po.location_id = p_location_id)
        and ((select private.app_is_admin()) or po.location_id = (select private.app_user_location_id()))
    ) as outstanding_po_units;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Receivables analytics summary: totals over the exact same eligibility
-- (invoices.status='issued', balance > 0) and per-invoice projection
-- (private.finance_invoice_projection) as customer_receivables_v2
-- (20260912120000), so the analytics total and the receivables list can
-- never disagree.
-- ---------------------------------------------------------------------------

create or replace function public.receivables_analytics_summary(
  p_location_id uuid default null
)
returns table (
  outstanding_receivables numeric,
  overdue_receivables numeric,
  outstanding_invoice_count bigint,
  overdue_invoice_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.finance_guard('receivables.view', p_location_id);

  return query
  select
    coalesce(sum((x->>'balance')::numeric), 0) as outstanding_receivables,
    coalesce(sum((x->>'balance')::numeric) filter (where (x->>'is_overdue')::boolean), 0) as overdue_receivables,
    count(*)::bigint as outstanding_invoice_count,
    count(*) filter (where (x->>'is_overdue')::boolean)::bigint as overdue_invoice_count
  from public.invoices as i
  cross join lateral private.finance_invoice_projection(i.id, false) as x
  where i.status = 'issued'
    and (p_location_id is null or i.location_id = p_location_id)
    and ((select private.app_is_admin()) or i.location_id = (select private.app_user_location_id()))
    and (x->>'balance')::numeric > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: same authenticated-only pattern as every existing RPC.
-- ---------------------------------------------------------------------------

revoke execute on function public.inventory_analytics_by_brand(text) from public, anon, service_role;
grant execute on function public.inventory_analytics_by_brand(text) to authenticated;

revoke execute on function public.inventory_analytics_by_size(text) from public, anon, service_role;
grant execute on function public.inventory_analytics_by_size(text) to authenticated;

revoke execute on function public.inventory_analytics_by_category(text) from public, anon, service_role;
grant execute on function public.inventory_analytics_by_category(text) to authenticated;

revoke execute on function public.stock_movement_summary(text, integer) from public, anon, service_role;
grant execute on function public.stock_movement_summary(text, integer) to authenticated;

revoke execute on function public.fast_moving_products(text, integer, integer) from public, anon, service_role;
grant execute on function public.fast_moving_products(text, integer, integer) to authenticated;

revoke execute on function public.slow_moving_products(text, integer) from public, anon, service_role;
grant execute on function public.slow_moving_products(text, integer) to authenticated;

revoke execute on function public.purchasing_analytics_summary(uuid) from public, anon, service_role;
grant execute on function public.purchasing_analytics_summary(uuid) to authenticated;

revoke execute on function public.receivables_analytics_summary(uuid) from public, anon, service_role;
grant execute on function public.receivables_analytics_summary(uuid) to authenticated;
