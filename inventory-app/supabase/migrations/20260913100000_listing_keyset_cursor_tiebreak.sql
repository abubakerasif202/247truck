-- Keyset pagination tie-break for quote_summary, job_summary and
-- purchase_order_summary.
--
-- The previous cursor filtered on the timestamp alone (`created_at < p_cursor`)
-- while ordering on (created_at desc, id desc). Rows that share a timestamp
-- (any multi-row insert inside one transaction, where now() is fixed) and
-- straddle a page boundary were silently skipped by the next page. The cursor
-- is now the full (timestamp, id) pair: callers pass the `next_cursor_id`
-- returned alongside `next_cursor`. A null p_cursor_id keeps the old
-- timestamp-only behaviour so in-flight callers are not broken mid-deploy.
--
-- Each function is dropped by exact signature before being recreated: adding a
-- parameter through `create or replace` would leave the old overload live.

drop function if exists public.quote_summary(uuid, text, timestamptz, integer);
drop function if exists public.job_summary(uuid, text, text, timestamptz, integer);
drop function if exists public.purchase_order_summary(uuid, text, uuid, timestamptz, integer);

create function public.quote_summary(p_location_id uuid default null, p_status text default null, p_cursor timestamptz default null, p_limit integer default 50, p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_rows jsonb; fetched integer; last_row jsonb;
begin
  if not (select private.sales_permission('quotes.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  select coalesce(pg_catalog.jsonb_agg(row_data order by created_at desc, id desc), '[]'::jsonb) into page_rows from (
    select q.id, q.created_at, pg_catalog.jsonb_build_object(
      'id', q.id, 'quote_number', q.quote_number, 'customer_id', q.customer_id,
      'customer_name', q.customer_snapshot->>'display_name', 'location_id', q.location_id,
      'status', q.status, 'total_incl_gst', q.total_incl_gst, 'pricing_complete', q.pricing_complete,
      'version', q.version, 'created_at', q.created_at
    ) row_data
    from public.quotes q
    where (p_location_id is null or q.location_id = p_location_id)
      and (select private.sales_location_allowed(q.location_id))
      and (p_status is null or q.status = p_status)
      and (p_cursor is null
        or (p_cursor_id is null and q.created_at < p_cursor)
        or (p_cursor_id is not null and (q.created_at, q.id) < (p_cursor, p_cursor_id)))
    order by q.created_at desc, q.id desc
    limit p_limit + 1
  ) page;
  fetched := jsonb_array_length(page_rows);
  if fetched > p_limit then page_rows := page_rows - (fetched - 1); end if;
  last_row := case when fetched > p_limit then page_rows -> (p_limit - 1) else null end;
  return jsonb_build_object('rows', page_rows, 'has_more', fetched > p_limit,
    'next_cursor', case when last_row is null then null else last_row->'created_at' end,
    'next_cursor_id', case when last_row is null then null else last_row->'id' end);
end;
$$;

revoke execute on function public.quote_summary(uuid, text, timestamptz, integer, uuid) from public, anon, service_role;
grant execute on function public.quote_summary(uuid, text, timestamptz, integer, uuid) to authenticated;

create function public.job_summary(p_location_id uuid default null, p_status text default null, p_query text default null, p_cursor timestamptz default null, p_limit integer default 50, p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text := lower(btrim(coalesce(p_query, ''))); page_rows jsonb; fetched integer; last_row jsonb;
begin
  if not (select private.sales_permission('jobs.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  select coalesce(pg_catalog.jsonb_agg(row_data order by opened_at desc, id desc), '[]'::jsonb) into page_rows from (
    select j.id, j.opened_at, pg_catalog.jsonb_build_object(
      'id', j.id, 'job_number', j.job_number, 'customer_id', j.customer_id,
      'customer_name', j.customer_snapshot->>'display_name', 'vehicle_registration', j.vehicle_snapshot->>'registration',
      'location_id', j.location_id, 'status', j.status, 'total_incl_gst', j.total_incl_gst,
      'pricing_complete', j.pricing_complete, 'version', j.version, 'opened_at', j.opened_at
    ) row_data
    from public.jobs j
    where (p_location_id is null or j.location_id = p_location_id)
      and (select private.sales_location_allowed(j.location_id))
      and (p_status is null or j.status = p_status)
      and (term = '' or lower(concat_ws(' ', j.job_number, j.customer_snapshot->>'display_name', j.vehicle_snapshot->>'registration')) like '%'||term||'%')
      and (p_cursor is null
        or (p_cursor_id is null and j.opened_at < p_cursor)
        or (p_cursor_id is not null and (j.opened_at, j.id) < (p_cursor, p_cursor_id)))
    order by j.opened_at desc, j.id desc
    limit p_limit + 1
  ) page;
  fetched := jsonb_array_length(page_rows);
  if fetched > p_limit then page_rows := page_rows - (fetched - 1); end if;
  last_row := case when fetched > p_limit then page_rows -> (p_limit - 1) else null end;
  return jsonb_build_object('rows', page_rows, 'has_more', fetched > p_limit,
    'next_cursor', case when last_row is null then null else last_row->'opened_at' end,
    'next_cursor_id', case when last_row is null then null else last_row->'id' end);
end;
$$;

revoke execute on function public.job_summary(uuid, text, text, timestamptz, integer, uuid) from public, anon, service_role;
grant execute on function public.job_summary(uuid, text, text, timestamptz, integer, uuid) to authenticated;

create function public.purchase_order_summary(
  p_location_id uuid default null,
  p_status text default null,
  p_supplier_id uuid default null,
  p_cursor timestamptz default null,
  p_limit integer default 50,
  p_cursor_id uuid default null
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
      and (p_cursor is null
        or (p_cursor_id is null and po.created_at < p_cursor)
        or (p_cursor_id is not null and (po.created_at, po.id) < (p_cursor, p_cursor_id)))
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
    'next_cursor', case when last_row is null then null else last_row->'created_at' end,
    'next_cursor_id', case when last_row is null then null else last_row->'purchase_order_id' end);
end;
$$;

revoke execute on function public.purchase_order_summary(uuid, text, uuid, timestamptz, integer, uuid)
  from public, anon, service_role;
grant execute on function public.purchase_order_summary(uuid, text, uuid, timestamptz, integer, uuid)
  to authenticated;
