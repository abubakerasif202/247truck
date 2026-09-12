-- Quotes, jobs and customers listings were hard-capped at a fixed p_limit
-- (100/100/100 rows) with no way to see anything beyond that and no signal
-- that more rows exist. This adds real pagination:
--  - quote_summary / job_summary: convert to the same jsonb
--    {rows, has_more, next_cursor} shape already used by
--    customer_receivables_v2, using keyset (cursor) pagination on their
--    existing sort order. Each has exactly one caller (lib/sales/queries.ts),
--    so the return-type change is safe to make in place.
--  - search_customers: adds p_offset (default 0) and an exact total count
--    via a window function, since its sort (active desc, display_name,
--    customer_number) is a natural fit for offset pagination and it already
--    has two callers (the customers listing page and POS/sales typeahead) —
--    p_offset defaults to 0 so the typeahead caller is unaffected.

drop function if exists public.quote_summary(uuid, text, timestamptz, integer);

create function public.quote_summary(p_location_id uuid default null, p_status text default null, p_cursor timestamptz default null, p_limit integer default 50)
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
      and (p_cursor is null or q.created_at < p_cursor)
    order by q.created_at desc, q.id desc
    limit p_limit + 1
  ) page;
  fetched := jsonb_array_length(page_rows);
  if fetched > p_limit then page_rows := page_rows - (fetched - 1); end if;
  last_row := case when fetched > p_limit then page_rows -> (p_limit - 1) else null end;
  return jsonb_build_object('rows', page_rows, 'has_more', fetched > p_limit,
    'next_cursor', case when last_row is null then null else last_row->'created_at' end);
end;
$$;

revoke execute on function public.quote_summary(uuid, text, timestamptz, integer) from public, anon, service_role;
grant execute on function public.quote_summary(uuid, text, timestamptz, integer) to authenticated;

drop function if exists public.job_summary(uuid, text, text, integer);

create function public.job_summary(p_location_id uuid default null, p_status text default null, p_query text default null, p_cursor timestamptz default null, p_limit integer default 50)
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
      and (p_cursor is null or j.opened_at < p_cursor)
    order by j.opened_at desc, j.id desc
    limit p_limit + 1
  ) page;
  fetched := jsonb_array_length(page_rows);
  if fetched > p_limit then page_rows := page_rows - (fetched - 1); end if;
  last_row := case when fetched > p_limit then page_rows -> (p_limit - 1) else null end;
  return jsonb_build_object('rows', page_rows, 'has_more', fetched > p_limit,
    'next_cursor', case when last_row is null then null else last_row->'opened_at' end);
end;
$$;

revoke execute on function public.job_summary(uuid, text, text, timestamptz, integer) from public, anon, service_role;
grant execute on function public.job_summary(uuid, text, text, timestamptz, integer) to authenticated;

drop function if exists public.search_customers(text, text, integer);

create function public.search_customers(p_query text default '', p_filter text default 'all', p_limit integer default 50, p_offset integer default 0)
returns table(id uuid, customer_number text, customer_type text, display_name text, phone text, payment_terms text, active boolean, vehicle_count bigint, total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare q text := lower(btrim(coalesce(p_query, ''))); digits text := private.customer_digits(p_query); vehicle_key text := private.customer_vehicle_key(p_query);
begin
  if not (select private.customer_permission('customers.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_filter not in ('all','individual','business','active','archived') or p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'INVALID_CUSTOMER_FILTER' using errcode='22023';
  end if;
  return query select c.id, c.customer_number, c.customer_type, c.display_name, coalesce(c.mobile,c.phone), c.payment_terms, c.active,
    (select count(*) from public.customer_vehicles v where v.customer_id=c.id and v.active),
    count(*) over()
  from public.customers c where
    (p_filter='all' or p_filter=c.customer_type or (p_filter='active' and c.active) or (p_filter='archived' and not c.active)) and
    (q='' or lower(c.customer_number) like '%'||q||'%' or lower(c.display_name) like '%'||q||'%' or lower(coalesce(c.company_name,'')) like '%'||q||'%' or lower(coalesce(c.email_normalized,'')) like '%'||q||'%' or lower(coalesce(c.billing_email_normalized,'')) like '%'||q||'%' or lower(coalesce(c.accounts_email_normalized,'')) like '%'||q||'%' or (digits is not null and (c.abn_normalized like '%'||digits||'%' or c.mobile_normalized like '%'||digits||'%' or c.phone_normalized like '%'||digits||'%')) or exists(select 1 from public.customer_contacts ct where ct.customer_id=c.id and ct.active and (lower(coalesce(ct.email_normalized,'')) like '%'||q||'%' or (digits is not null and (ct.mobile_normalized like '%'||digits||'%' or ct.phone_normalized like '%'||digits||'%')))) or exists(select 1 from public.customer_vehicles v where v.customer_id=c.id and v.active and (v.registration_normalized like '%'||vehicle_key||'%' or lower(coalesce(v.fleet_number_normalized,'')) like '%'||q||'%')))
  order by c.active desc, c.display_name, c.customer_number limit p_limit offset p_offset;
end;
$$;

revoke execute on function public.search_customers(text, text, integer, integer) from public, anon, service_role;
grant execute on function public.search_customers(text, text, integer, integer) to authenticated;

-- list_customers wraps search_customers with a bare filter/limit; keep it
-- working against the new signature (it never used p_offset/total_count).
create or replace function public.list_customers(p_filter text default 'all', p_limit integer default 50)
returns table(id uuid, customer_number text, customer_type text, display_name text, phone text, payment_terms text, active boolean, vehicle_count bigint)
language sql stable security invoker set search_path='' as $$
  select id, customer_number, customer_type, display_name, phone, payment_terms, active, vehicle_count
  from public.search_customers('', p_filter, p_limit, 0);
$$;
