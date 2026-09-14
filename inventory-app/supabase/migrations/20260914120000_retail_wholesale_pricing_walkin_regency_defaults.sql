-- Retail/wholesale pricing, walk-in quote contacts, and Regency Park defaults.
-- Forward-only and additive: legacy selling_price_incl_gst remains a retail
-- compatibility alias; historical line prices and inventory balances are not
-- rewritten.

alter table public.products
  add column if not exists retail_price_incl_gst numeric(14,2),
  add column if not exists wholesale_price_incl_gst numeric(14,2),
  add constraint products_retail_price_nonnegative_check check (retail_price_incl_gst is null or retail_price_incl_gst >= 0),
  add constraint products_wholesale_price_nonnegative_check check (wholesale_price_incl_gst is null or wholesale_price_incl_gst >= 0);

update public.products
set retail_price_incl_gst = selling_price_incl_gst
where retail_price_incl_gst is null;

alter table public.customers
  add column if not exists pricing_tier text not null default 'retail',
  add constraint customers_pricing_tier_check check (pricing_tier in ('retail','wholesale'));

-- Existing business accounts are the only existing customer class that has a
-- trade/accounting meaning, so they retain a safe wholesale default. Staff can
-- explicitly choose retail for future records through the customer form.
update public.customers
set pricing_tier = case when customer_type = 'business' then 'wholesale' else 'retail' end;

alter table public.quotes
  alter column customer_id drop not null,
  add column if not exists contact_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists pricing_tier text not null default 'retail',
  add constraint quotes_pricing_tier_check check (pricing_tier in ('retail','wholesale'));

alter table public.quote_lines
  add column if not exists pricing_tier text not null default 'retail',
  add constraint quote_lines_pricing_tier_check check (pricing_tier in ('retail','wholesale'));

alter table public.job_lines
  add column if not exists pricing_tier text not null default 'retail',
  add constraint job_lines_pricing_tier_check check (pricing_tier in ('retail','wholesale'));

create or replace function public.set_customer_pricing_tier(p_customer_id uuid, p_pricing_tier text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); old_tier text; role_name text;
begin
  if p_pricing_tier not in ('retail','wholesale') or (not private.app_has_permission('customers.edit') and not private.app_has_permission('customers.create')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select pricing_tier into old_tier from public.customers where id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  update public.customers set pricing_tier=p_pricing_tier, version=version+1 where id=p_customer_id;
  select role into role_name from public.user_profiles where user_id=actor;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(actor,role_name,null,'CUSTOMER_PRICING_TIER_CHANGED','customer',p_customer_id::text,jsonb_build_object('old_pricing_tier',old_tier,'new_pricing_tier',p_pricing_tier));
end; $$;
revoke execute on function public.set_customer_pricing_tier(uuid,text) from public,anon,service_role;
grant execute on function public.set_customer_pricing_tier(uuid,text) to authenticated;

create or replace function private.sync_retail_compatibility_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.retail_price_incl_gst is null and new.selling_price_incl_gst is not null then
      new.retail_price_incl_gst := new.selling_price_incl_gst;
    elsif new.selling_price_incl_gst is null and new.retail_price_incl_gst is not null then
      new.selling_price_incl_gst := new.retail_price_incl_gst;
    end if;
  elsif new.retail_price_incl_gst is null and new.selling_price_incl_gst is not null then
    new.retail_price_incl_gst := new.selling_price_incl_gst;
  elsif new.retail_price_incl_gst is distinct from old.retail_price_incl_gst
    and new.selling_price_incl_gst is not distinct from old.selling_price_incl_gst then
    new.selling_price_incl_gst := new.retail_price_incl_gst;
  elsif new.selling_price_incl_gst is distinct from old.selling_price_incl_gst
    and new.retail_price_incl_gst is not distinct from old.retail_price_incl_gst then
    new.retail_price_incl_gst := new.selling_price_incl_gst;
  end if;
  return new;
end;
$$;

drop trigger if exists products_sync_retail_compatibility_price on public.products;
create trigger products_sync_retail_compatibility_price
before insert or update on public.products
for each row execute function private.sync_retail_compatibility_price();

create or replace function private.product_sale_price(p_product_id uuid, p_pricing_tier text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_pricing_tier = 'wholesale'
    then wholesale_price_incl_gst
    else retail_price_incl_gst
  end
  from public.products
  where id = p_product_id and active;
$$;
revoke execute on function private.product_sale_price(uuid,text) from public, anon, authenticated, service_role;

create or replace function public.set_product_prices(
  p_product_id uuid,
  p_retail_price_incl_gst numeric,
  p_wholesale_price_incl_gst numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  old_retail numeric;
  old_wholesale numeric;
  actor_role text;
begin
  if not (select private.app_has_permission('inventory.edit_global_price')) then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_retail_price_incl_gst is not null and p_retail_price_incl_gst < 0
    or p_wholesale_price_incl_gst is not null and p_wholesale_price_incl_gst < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;
  select retail_price_incl_gst, wholesale_price_incl_gst
    into old_retail, old_wholesale
  from public.products where id = p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.products
  set retail_price_incl_gst = p_retail_price_incl_gst,
      selling_price_incl_gst = p_retail_price_incl_gst,
      wholesale_price_incl_gst = p_wholesale_price_incl_gst
  where id = p_product_id;
  select role into actor_role from public.user_profiles where user_id = actor;
  insert into public.audit_events(actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details)
  values (actor, actor_role, null, 'PRODUCT_PRICES_CHANGED', 'product', p_product_id::text,
    jsonb_build_object(
      'old_retail_price_incl_gst', old_retail,
      'new_retail_price_incl_gst', p_retail_price_incl_gst,
      'old_wholesale_price_incl_gst', old_wholesale,
      'new_wholesale_price_incl_gst', p_wholesale_price_incl_gst
    ));
end;
$$;
revoke execute on function public.set_product_prices(uuid,numeric,numeric) from public, anon, service_role;
grant execute on function public.set_product_prices(uuid,numeric,numeric) to authenticated;

create or replace function public.create_product_with_prices(
  p_name text,
  p_category_code text,
  p_retail_price_incl_gst numeric,
  p_wholesale_price_incl_gst numeric default null,
  p_part_reference text default null,
  p_notes text default null,
  p_tyre_condition text default null,
  p_tyre_brand text default null,
  p_tyre_pattern text default null,
  p_tyre_size text default null,
  p_load_index text default null,
  p_speed_rating text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare product_id uuid;
begin
  if p_retail_price_incl_gst is not null and p_retail_price_incl_gst < 0
    or p_wholesale_price_incl_gst is not null and p_wholesale_price_incl_gst < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;
  product_id := public.create_product(
    p_name, p_category_code, p_retail_price_incl_gst, p_part_reference, p_notes,
    p_tyre_condition, p_tyre_brand, p_tyre_pattern, p_tyre_size, p_load_index, p_speed_rating
  );
  perform public.set_product_prices(product_id, p_retail_price_incl_gst, p_wholesale_price_incl_gst);
  return product_id;
end;
$$;
revoke execute on function public.create_product_with_prices(text,text,numeric,numeric,text,text,text,text,text,text,text,text) from public, anon, service_role;
grant execute on function public.create_product_with_prices(text,text,numeric,numeric,text,text,text,text,text,text,text,text) to authenticated;

create or replace view public.inventory_product_summary
with (security_barrier = true)
as
select p.id as product_id, p.name, p.category_code, p.part_reference,
  p.selling_price_incl_gst, p.active, p.tyre_condition, tb.display_name as brand_name,
  tp.display_name as pattern_name, ts.display_size as size_name, b.location_id,
  l.code as location_code, l.name as location_name, b.on_hand, b.reserved,
  (b.on_hand - b.reserved) as available,
  case when (select private.app_has_permission('inventory.view_cost')) then b.weighted_average_cost end as weighted_average_cost,
  coalesce(s.minimum_stock, 0) as minimum_stock, coalesce(s.reorder_quantity, 0) as reorder_quantity,
  ((b.on_hand - b.reserved) < coalesce(s.minimum_stock, 0)) as low_stock,
  p.retail_price_incl_gst, p.wholesale_price_incl_gst
from public.products p
join public.inventory_balances b on b.product_id = p.id
join public.locations l on l.id = b.location_id
left join public.inventory_settings s on s.product_id = p.id and s.location_id = b.location_id
left join public.tyre_brands tb on tb.id = p.tyre_brand_id
left join public.tyre_patterns tp on tp.id = p.tyre_pattern_id
left join public.tyre_sizes ts on ts.id = p.tyre_size_id
where (select private.app_is_admin()) or b.location_id = (select private.app_user_location_id());
revoke all on public.inventory_product_summary from public, anon;
grant select on public.inventory_product_summary to authenticated;

create or replace function public.inventory_summary_page(
  p_location_code text default null, p_product_id uuid default null, p_search text default null,
  p_category text default null, p_tyre_condition text default null, p_low_stock_only boolean default false,
  p_include_archived boolean default false, p_offset integer default 0, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_search,''))); total bigint; page_rows jsonb;
begin
  if (select auth.uid()) is null or not (select private.app_has_permission('inventory.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_offset<0 or p_limit not between 1 and 200 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  if p_location_code is not null and not exists(select 1 from public.locations l where l.code=p_location_code) then raise exception 'INVALID_LOCATION' using errcode='22023'; end if;
  if p_location_code is not null and not (select private.app_is_admin())
     and (select l.id from public.locations l where l.code=p_location_code) is distinct from (select private.app_user_location_id()) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  with scope as (
    select distinct s.product_id from public.inventory_product_summary s
    where (p_include_archived or s.active) and (p_product_id is null or s.product_id=p_product_id)
      and (p_location_code is null or s.location_code=p_location_code) and (p_category is null or s.category_code=p_category)
      and (p_tyre_condition is null or s.tyre_condition=p_tyre_condition) and (not p_low_stock_only or s.low_stock)
      and (term='' or lower(concat_ws(' ',s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name)) like '%'||term||'%')
  ), counted as (select count(*) total from scope), page as (
    select p.id,p.name from public.products p join scope sc on sc.product_id=p.id order by p.name,p.id offset p_offset limit p_limit
  ), page_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'product_id',s.product_id,'name',s.name,'category_code',s.category_code,'part_reference',s.part_reference,
      'retail_price_incl_gst',s.retail_price_incl_gst,'wholesale_price_incl_gst',s.wholesale_price_incl_gst,
      'selling_price_incl_gst',s.selling_price_incl_gst,'tyre_condition',s.tyre_condition,'brand_name',s.brand_name,
      'pattern_name',s.pattern_name,'size_name',s.size_name,'location_code',s.location_code,'location_name',s.location_name,
      'on_hand',s.on_hand,'reserved',s.reserved,'available',s.available,'weighted_average_cost',s.weighted_average_cost,
      'minimum_stock',s.minimum_stock,'reorder_quantity',s.reorder_quantity,'low_stock',s.low_stock,'active',s.active
    ) order by s.name,s.product_id,s.location_code),'[]'::jsonb) rows_json
    from public.inventory_product_summary s join page on page.id=s.product_id
    where (p_location_code is null or s.location_code=p_location_code) and (p_product_id is null or s.product_id=p_product_id)
      and (p_category is null or s.category_code=p_category) and (p_tyre_condition is null or s.tyre_condition=p_tyre_condition)
      and (not p_low_stock_only or s.low_stock) and (p_include_archived or s.active)
      and (term='' or lower(concat_ws(' ',s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name)) like '%'||term||'%')
  ) select counted.total,page_json.rows_json into total,page_rows from counted,page_json;
  return jsonb_build_object('rows',page_rows,'total_products',total,'offset',p_offset,'limit',p_limit,'has_more',p_offset+p_limit<total);
end; $$;

-- PostgreSQL cannot replace a RETURNS TABLE function when its OUT row type
-- changes. This RPC has no database-level callers; the application contract
-- remains compatible and the function is recreated transactionally.
drop function if exists public.sales_product_search(uuid,text,integer);
create function public.sales_product_search(p_location_id uuid default null,p_query text default null,p_limit integer default 30)
returns table(product_id uuid,name text,part_reference text,brand_name text,pattern_name text,size_name text,tyre_condition text,
  selling_price_incl_gst numeric,retail_price_incl_gst numeric,wholesale_price_incl_gst numeric,on_hand integer,reserved integer,available integer)
language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_query,'')));
begin
  if not private.sales_permission('quotes.view') and not private.sales_permission('jobs.view') and not private.sales_permission('pos.use') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  return query select s.product_id,s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name,s.tyre_condition,
    s.selling_price_incl_gst,s.retail_price_incl_gst,s.wholesale_price_incl_gst,s.on_hand,s.reserved,s.available
  from public.inventory_product_summary s where s.active and (p_location_id is null or s.location_id=p_location_id)
    and (term='' or lower(concat_ws(' ',s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name)) like '%'||term||'%')
    and (p_location_id is null or private.sales_location_allowed(s.location_id))
  order by s.name,s.product_id limit p_limit;
end; $$;
revoke execute on function public.sales_product_search(uuid,text,integer) from public,anon,service_role;
grant execute on function public.sales_product_search(uuid,text,integer) to authenticated;

-- A quote line is an immutable agreed price. This trigger only supplies the
-- selected tier label when callers omit it; it never changes an existing line.
create or replace function private.quote_line_pricing_tier()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.pricing_tier = 'retail' then
    select pricing_tier into new.pricing_tier from public.quotes where id=new.quote_id;
  end if;
  return new;
end; $$;
drop trigger if exists quote_lines_pricing_tier_default on public.quote_lines;
create trigger quote_lines_pricing_tier_default before insert on public.quote_lines for each row execute function private.quote_line_pricing_tier();

create or replace function private.job_line_pricing_tier()
returns trigger language plpgsql security definer set search_path='' as $$
declare inherited_tier text;
begin
  if new.pricing_tier = 'retail' then
    select ql.pricing_tier into inherited_tier
    from public.jobs j join public.quote_lines ql on ql.quote_id=j.source_quote_id
    where j.id=new.job_id and ql.line_position=new.line_position;
    if inherited_tier is not null then new.pricing_tier := inherited_tier; end if;
  end if;
  return new;
end; $$;
drop trigger if exists job_lines_pricing_tier_default on public.job_lines;
create trigger job_lines_pricing_tier_default before insert on public.job_lines for each row execute function private.job_line_pricing_tier();

create or replace function public.create_walk_in_quote(
  p_request_id uuid,p_location_id uuid,p_contact jsonb,p_quote jsonb,p_lines jsonb
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); qid uuid:=extensions.gen_random_uuid(); number text; row jsonb; product public.products%rowtype;
  pos integer:=0; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; payload_hash text; prior public.commercial_action_requests%rowtype;
  contact_name text:=nullif(btrim(p_contact->>'name'),''); contact_phone text:=nullif(btrim(p_contact->>'phone'),''); contact_email text:=nullif(btrim(p_contact->>'email'),'');
begin
  if p_request_id is null or not private.sales_permission('quotes.create') or not private.sales_location_allowed(p_location_id) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if contact_name is null then raise exception 'CUSTOMER_NAME_REQUIRED' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  payload_hash:=encode(extensions.digest(convert_to(coalesce(p_contact,'{}')::text||coalesce(p_quote,'{}')::text||coalesce(p_lines,'[]')::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.commercial_action_requests where request_id=p_request_id;
  if found then if prior.action='create_walk_in_quote' and prior.actor_user_id=actor and prior.payload_hash=payload_hash then return prior.result; end if; raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
  number:=private.next_sales_number(p_location_id,'quote');
  insert into public.quotes(id,quote_number,location_id,customer_id,customer_reference,customer_notes,customer_snapshot,contact_snapshot,pricing_tier,created_by)
  values(qid,number,p_location_id,null,nullif(btrim(p_quote->>'customer_reference'),''),nullif(btrim(p_quote->>'customer_notes'),''),jsonb_build_object('display_name',contact_name,'customer_type','walk_in'),jsonb_build_object('name',contact_name,'phone',contact_phone,'email',contact_email),'retail',actor);
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid and active;
      if not found or qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
      price:=product.retail_price_incl_gst; if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.quote_lines(quote_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier)
      values(qid,pos,'product',product.id,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,'retail');
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.quote_lines(quote_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier)
      values(qid,pos,'labour',btrim(row->>'description'),qty,price,line_total,'retail');
    else raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
  end loop;
  update public.quotes set subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete where id=qid;
  result:=jsonb_build_object('quote_id',qid,'quote_number',number,'status','draft','pricing_complete',complete,'total_incl_gst',case when complete then total else null end,'version',1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'create_walk_in_quote',actor,qid,payload_hash,result);
  perform private.sales_audit('WALK_IN_QUOTE_CREATED','quote',qid,p_location_id,jsonb_build_object('quote_number',number,'contact_snapshot',jsonb_build_object('name',contact_name,'phone',contact_phone,'email',contact_email)));
  return result;
end; $$;
revoke execute on function public.create_walk_in_quote(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.create_walk_in_quote(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

-- Make missing Admin scope safe by database convention as well as UI.
update public.locations set active=true where code in ('REG','LON');

-- Rebind the two server-side product pricing entry points used by quotes and
-- POS/jobs. The client never decides the master price and WAC is not involved.
create or replace function public.create_quote(p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); qid uuid:=extensions.gen_random_uuid(); number text; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; payload_hash text; prior public.commercial_action_requests%rowtype; tier text;
begin
  if p_request_id is null or not private.sales_permission('quotes.create') or not private.sales_location_allowed(p_location_id) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  select * into c from public.customers where id=p_customer_id and active; if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  tier:=case when c.pricing_tier='wholesale' then 'wholesale' else 'retail' end;
  if p_customer_vehicle_id is not null then select * into v from public.customer_vehicles where id=p_customer_vehicle_id and customer_id=p_customer_id and active; if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  payload_hash:=encode(extensions.digest(convert_to(coalesce(p_quote,'{}')::text||coalesce(p_lines,'[]')::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.commercial_action_requests where request_id=p_request_id;
  if found then if prior.action='create_quote' and prior.actor_user_id=actor and prior.payload_hash=payload_hash then return prior.result; end if; raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
  number:=private.next_sales_number(p_location_id,'quote');
  insert into public.quotes(id,quote_number,location_id,customer_id,customer_vehicle_id,customer_reference,internal_notes,customer_notes,expiry_date,customer_snapshot,vehicle_snapshot,pricing_tier,created_by)
  values(qid,number,p_location_id,p_customer_id,p_customer_vehicle_id,nullif(btrim(p_quote->>'customer_reference'),''),nullif(btrim(p_quote->>'internal_notes'),''),nullif(btrim(p_quote->>'customer_notes'),''),(p_quote->>'expiry_date')::date,to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized',case when p_customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,tier,actor);
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      price:=private.product_sale_price(product.id,tier); if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.quote_lines(quote_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier) values(qid,pos,'product',product.id,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,tier);
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.quote_lines(quote_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier) values(qid,pos,'labour',btrim(row->>'description'),qty,price,line_total,tier);
    else raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
  end loop;
  update public.quotes set subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete where id=qid;
  result:=jsonb_build_object('quote_id',qid,'quote_number',number,'status','draft','pricing_complete',complete,'pricing_tier',tier,'subtotal_ex_gst',case when complete then total-round(total/11,2) else null end,'gst_amount',case when complete then round(total/11,2) else null end,'total_incl_gst',case when complete then total else null end,'version',1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'create_quote',actor,qid,payload_hash,result);
  perform private.sales_audit('QUOTE_CREATED','quote',qid,p_location_id,jsonb_build_object('quote_number',number,'pricing_tier',tier,'pricing_complete',complete));
  return result;
end; $$;

create or replace function public.create_job(p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); jid uuid:=extensions.gen_random_uuid(); number text; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; payload_hash text; prior public.commercial_action_requests%rowtype; tier text:='retail';
begin
  if p_request_id is null or not private.sales_permission('jobs.create') or not private.sales_location_allowed(p_location_id) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if p_customer_id is null then if coalesce(p_job->>'source_type','direct')<>'pos' or nullif(btrim(p_job->>'walk_in_label'),'') is null then raise exception 'CUSTOMER_REQUIRED' using errcode='22023'; end if;
  else select * into c from public.customers where id=p_customer_id and active; if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if; tier:=case when c.pricing_tier='wholesale' then 'wholesale' else 'retail' end; end if;
  if p_customer_vehicle_id is not null then select * into v from public.customer_vehicles where id=p_customer_vehicle_id and customer_id=p_customer_id and active; if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0)); payload_hash:=encode(extensions.digest(convert_to(coalesce(p_job,'{}')::text||coalesce(p_lines,'[]')::text,'UTF8'),'sha256'),'hex'); select * into prior from public.commercial_action_requests where request_id=p_request_id;
  if found then if prior.action='create_job' and prior.actor_user_id=actor and prior.payload_hash=payload_hash then return prior.result; end if; raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
  number:=private.next_sales_number(p_location_id,'job');
  insert into public.jobs(id,job_number,location_id,source_type,customer_id,customer_vehicle_id,customer_snapshot,vehicle_snapshot,customer_reference,technician_notes,customer_notes,created_by) values(jid,number,p_location_id,coalesce(nullif(p_job->>'source_type',''),'direct'),p_customer_id,p_customer_vehicle_id,case when p_customer_id is null then jsonb_build_object('display_name',btrim(p_job->>'walk_in_label'),'customer_type','walk_in') else to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized' end,case when p_customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,nullif(btrim(p_job->>'customer_reference'),''),nullif(btrim(p_job->>'technician_notes'),''),nullif(btrim(p_job->>'customer_notes'),''),actor);
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then select * into product from public.products where id=(row->>'product_id')::uuid; if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if; if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if; price:=private.product_sale_price(product.id,tier); if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if; insert into public.job_lines(job_id,line_position,line_type,product_id,used_tyre_unit_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier) values(jid,pos,'product',product.id,nullif(row->>'used_tyre_unit_id','')::uuid,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,tier);
    elsif row->>'line_type'='labour' then price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if; line_total:=round(qty*price,2); total:=total+line_total; insert into public.job_lines(job_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier) values(jid,pos,'labour',btrim(row->>'description'),qty,price,line_total,tier);
    else raise exception 'INVALID_JOB_LINE' using errcode='22023'; end if;
  end loop;
  update public.jobs set subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete where id=jid;
  perform private.reserve_job_lines(jid,p_location_id,actor); result:=jsonb_build_object('job_id',jid,'job_number',number,'status','new','pricing_complete',complete,'pricing_tier',tier,'total_incl_gst',case when complete then total else null end,'version',1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'create_job',actor,jid,payload_hash,result); perform private.sales_audit('JOB_CREATED','job',jid,p_location_id,jsonb_build_object('job_number',number,'source_type',coalesce(nullif(p_job->>'source_type',''),'direct'),'pricing_tier',tier)); return result;
end; $$;
