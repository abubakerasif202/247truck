-- Report valued and unvalued inventory separately so unresolved opening stock
-- is never treated as zero-cost inventory.

create or replace function public.inventory_valuation_for_scope(
  p_location_code text default null
)
returns table (known_value numeric, unvalued_units bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_has_permission('reports.view_inventory_value')
    or not private.app_has_permission('inventory.view_cost') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(
      case when b.weighted_average_cost is not null
        then b.on_hand * b.weighted_average_cost
        else 0 end
    ), 0)::numeric as known_value,
    coalesce(sum(
      case when b.on_hand > 0 and b.weighted_average_cost is null
        then b.on_hand else 0 end
    ), 0)::bigint as unvalued_units
  from public.inventory_balances as b
  join public.products as p on p.id = b.product_id and p.active
  join public.locations as l on l.id = b.location_id
  where (p_location_code is null or l.code = p_location_code)
    and (
      (select private.app_is_admin())
      or b.location_id = (select private.app_user_location_id())
    );
end;
$$;

revoke execute on function public.inventory_valuation_for_scope(text)
  from public, anon, service_role;
grant execute on function public.inventory_valuation_for_scope(text)
  to authenticated;
