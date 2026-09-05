-- Bounded, cost-free picker endpoint for individually tracked used tyres.
-- The job RPC remains the authority: this is only a candidate lookup.
create or replace function public.sales_used_tyre_unit_search(
  p_product_id uuid,
  p_location_id uuid,
  p_query text default null,
  p_limit integer default 20
)
returns table(
  id uuid,
  internal_unit_code text,
  condition text,
  tread_depth_mm numeric,
  product_id uuid,
  location_id uuid,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  term text := lower(btrim(coalesce(p_query, '')));
  result_limit integer := least(greatest(coalesce(p_limit, 20), 1), 30);
begin
  if (select auth.uid()) is null
     or not (select private.app_has_permission('quotes.view')
             or private.app_has_permission('jobs.view')
             or private.app_has_permission('pos.use'))
     or p_product_id is null
     or p_location_id is null
     or not (select private.sales_location_allowed(p_location_id)) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select u.id, u.internal_unit_code, u.condition, u.tread_depth_mm,
         u.product_id, u.location_id, u.status
    from public.used_tyre_units as u
    join public.products as p on p.id = u.product_id
   where u.product_id = p_product_id
     and u.location_id = p_location_id
     and u.status = 'available'
     and p.active
     and p.tyre_condition = 'used'
     and (term = '' or lower(u.internal_unit_code) like '%' || term || '%')
   order by u.internal_unit_code, u.id
   limit result_limit;
end;
$$;

revoke execute on function public.sales_used_tyre_unit_search(uuid, uuid, text, integer) from public, anon, service_role;
grant execute on function public.sales_used_tyre_unit_search(uuid, uuid, text, integer) to authenticated;
