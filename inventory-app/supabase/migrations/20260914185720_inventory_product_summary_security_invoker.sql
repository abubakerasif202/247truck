-- Fixes the Supabase security advisor ERROR "Security Definer View" on
-- public.inventory_product_summary.
--
-- The view previously ran with its owner's (postgres) privileges by default
-- (Postgres' pre-PG15 view default, still the default unless a view opts
-- into security_invoker), bypassing RLS on every underlying table. That
-- bypass was load-bearing: the view enforces branch scoping and per-user
-- cost-column redaction itself (mirroring, respectively, the
-- inventory_balances_read RLS policy and the "inventory.view_cost"
-- permission check) rather than relying on grants — and
-- lib/inventory/repository.ts queries this view directly as the signed-in
-- user via PostgREST, selecting weighted_average_cost by name. Flipping the
-- view straight to security_invoker=true without this change would have
-- required a raw table-level SELECT grant on inventory_balances.
-- weighted_average_cost to the shared `authenticated` Postgres role — which
-- has no way to distinguish "has inventory.view_cost" from "does not", so
-- every authenticated user would see real cost data, or (if the grant is
-- withheld) the query would hard-fail with "permission denied for column"
-- for every authenticated user, cost-permitted or not.
--
-- The fix used everywhere else in this codebase for exactly this shape of
-- problem: move the elevated logic into a SECURITY DEFINER *function*
-- (a black box to the invoker — no column/row grants needed on the tables
-- it touches internally) and make the view itself a thin, security_invoker
-- wrapper around it. The view's output columns, ordering, and observable
-- behaviour (branch scoping, cost redaction) are unchanged.
--
-- Note: SECURITY DEFINER functions are never inlined by the planner, so a
-- caller's WHERE/LIMIT can no longer be pushed down into the join — every
-- call now materialises every row visible to the caller before filtering.
-- At current scale (dozens of products, low hundreds of balance rows) this
-- is immaterial; if the catalogue grows into the thousands, revisit with a
-- paginated/parameterised function instead of a bare view.

create or replace function private.inventory_product_summary()
returns table (
  product_id uuid,
  name text,
  category_code text,
  part_reference text,
  selling_price_incl_gst numeric,
  active boolean,
  tyre_condition text,
  brand_name text,
  pattern_name text,
  size_name text,
  location_id uuid,
  location_code text,
  location_name text,
  on_hand integer,
  reserved integer,
  available integer,
  weighted_average_cost numeric,
  minimum_stock integer,
  reorder_quantity integer,
  low_stock boolean,
  retail_price_incl_gst numeric,
  wholesale_price_incl_gst numeric
)
language sql
stable
security definer
set search_path = ''
as $$
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
    b.on_hand - b.reserved as available,
    case
      when private.app_has_permission('inventory.view_cost') then b.weighted_average_cost
      else null::numeric
    end as weighted_average_cost,
    coalesce(s.minimum_stock, 0) as minimum_stock,
    coalesce(s.reorder_quantity, 0) as reorder_quantity,
    (b.on_hand - b.reserved) < coalesce(s.minimum_stock, 0) as low_stock,
    p.retail_price_incl_gst,
    p.wholesale_price_incl_gst
  from public.products p
    join public.inventory_balances b on b.product_id = p.id
    join public.locations l on l.id = b.location_id
    left join public.inventory_settings s on s.product_id = p.id and s.location_id = b.location_id
    left join public.tyre_brands tb on tb.id = p.tyre_brand_id
    left join public.tyre_patterns tp on tp.id = p.tyre_pattern_id
    left join public.tyre_sizes ts on ts.id = p.tyre_size_id
  where private.app_is_admin() or b.location_id = private.app_user_location_id();
$$;

revoke all on function private.inventory_product_summary() from public, anon, authenticated, service_role;
grant execute on function private.inventory_product_summary() to authenticated;

create or replace view public.inventory_product_summary
with (security_invoker = true)
as select
  product_id,
  name,
  category_code,
  part_reference,
  selling_price_incl_gst::numeric(14, 2) as selling_price_incl_gst,
  active,
  tyre_condition,
  brand_name,
  pattern_name,
  size_name,
  location_id,
  location_code,
  location_name,
  on_hand,
  reserved,
  available,
  weighted_average_cost,
  minimum_stock,
  reorder_quantity,
  low_stock,
  retail_price_incl_gst::numeric(14, 2) as retail_price_incl_gst,
  wholesale_price_incl_gst::numeric(14, 2) as wholesale_price_incl_gst
from private.inventory_product_summary();
