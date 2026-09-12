-- purchase_order_summary had no limit (fully unbounded fetch) and the
-- supplier filter was applied client-side in JS after fetching everything,
-- so it never reduced the amount of data pulled from the database. This adds
-- a p_supplier_id filter to the query itself and keyset pagination on the
-- existing created_at/id sort order, matching the {rows, has_more,
-- next_cursor} shape used elsewhere (quote_summary, job_summary,
-- customer_receivables_v2).

drop function if exists public.purchase_order_summary(uuid, text);

create function public.purchase_order_summary(
  p_location_id uuid default null,
  p_status text default null,
  p_supplier_id uuid default null,
  p_cursor timestamptz default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare page_rows jsonb; fetched integer; last_row jsonb;
begin
  if not (select private.app_has_permission('purchasing.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if not (select private.app_is_admin()) then
    if p_location_id is not null
      and p_location_id is distinct from (select private.app_user_location_id()) then
      raise exception 'ACCESS_DENIED' using errcode = '42501';
    end if;
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.jsonb_agg(row_data order by created_at desc, purchase_order_id desc), '[]'::jsonb)
    into page_rows
  from (
    select
      po.id as purchase_order_id,
      po.created_at,
      pg_catalog.jsonb_build_object(
        'purchase_order_id', po.id,
        'po_number', po.po_number,
        'location_id', po.location_id,
        'location_code', location.code,
        'supplier_id', po.supplier_id,
        'supplier_name', supplier.name,
        'status', po.status,
        'created_at', po.created_at,
        'ordered_total', case
          when (select private.app_has_permission('inventory.view_cost'))
          then coalesce(totals.ordered_total, 0::numeric)
          else null::numeric
        end,
        'ordered_quantity', coalesce(totals.ordered_quantity, 0)::bigint,
        'outstanding_quantity', coalesce(totals.outstanding_quantity, 0)::bigint
      ) as row_data
    from public.purchase_orders as po
    join public.locations as location on location.id = po.location_id
    join public.suppliers as supplier on supplier.id = po.supplier_id
    left join lateral (
      select
        sum(line.ordered_quantity * line.unit_cost) as ordered_total,
        sum(line.ordered_quantity) as ordered_quantity,
        sum(line.ordered_quantity - line.received_quantity) as outstanding_quantity
      from public.purchase_order_lines as line
      where line.purchase_order_id = po.id
    ) as totals on true
    where (p_status is null or po.status = p_status)
      and (p_location_id is null or po.location_id = p_location_id)
      and (p_supplier_id is null or po.supplier_id = p_supplier_id)
      and (p_cursor is null or po.created_at < p_cursor)
      and (
        (select private.app_is_admin())
        or po.location_id = (select private.app_user_location_id())
      )
    order by po.created_at desc, po.id desc
    limit p_limit + 1
  ) page;

  fetched := jsonb_array_length(page_rows);
  if fetched > p_limit then page_rows := page_rows - (fetched - 1); end if;
  last_row := case when fetched > p_limit then page_rows -> (p_limit - 1) else null end;
  return jsonb_build_object('rows', page_rows, 'has_more', fetched > p_limit,
    'next_cursor', case when last_row is null then null else last_row->'created_at' end);
end;
$$;

revoke execute on function public.purchase_order_summary(uuid, text, uuid, timestamptz, integer)
  from public, anon, service_role;
grant execute on function public.purchase_order_summary(uuid, text, uuid, timestamptz, integer)
  to authenticated;

-- The dashboard needs an accurate count of ALL open purchase orders by
-- status, not just the first page of the listing above — a dedicated
-- aggregate query rather than reusing the now-paginated summary RPC (which
-- would have silently undercounted past the first page).
create or replace function public.purchase_order_status_counts(p_location_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare counts jsonb;
begin
  if not (select private.app_has_permission('purchasing.view')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if not (select private.app_is_admin()) then
    if p_location_id is not null
      and p_location_id is distinct from (select private.app_user_location_id()) then
      raise exception 'ACCESS_DENIED' using errcode = '42501';
    end if;
  end if;

  select coalesce(pg_catalog.jsonb_object_agg(status, status_count), '{}'::jsonb)
    into counts
  from (
    select po.status, count(*) as status_count
    from public.purchase_orders as po
    where (p_location_id is null or po.location_id = p_location_id)
      and (
        (select private.app_is_admin())
        or po.location_id = (select private.app_user_location_id())
      )
    group by po.status
  ) grouped;
  return counts;
end;
$$;

revoke execute on function public.purchase_order_status_counts(uuid) from public, anon, service_role;
grant execute on function public.purchase_order_status_counts(uuid) to authenticated;
