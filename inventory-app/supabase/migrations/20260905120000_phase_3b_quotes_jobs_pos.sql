-- Phase 3B foundation: quotes and the job identity needed for quote conversion.
-- Stock reservations and completion are added only with the job transaction task.

alter table public.manager_permissions drop constraint manager_permissions_permission_key_check;
alter table public.manager_permissions add constraint manager_permissions_permission_key_check check (permission_key in (
  'inventory.view','inventory.stock_in','inventory.stock_out','inventory.adjust','inventory.view_cost',
  'inventory.edit_global_price','inventory.transfer_request','purchasing.view','purchasing.create_po',
  'purchasing.submit_po','purchasing.receive_po','reports.view_inventory_value',
  'customers.view','customers.create','customers.edit','customers.manage_contacts','customers.manage_vehicles',
  'quotes.view','quotes.create','quotes.edit','quotes.accept',
  'jobs.view','jobs.create','jobs.edit','jobs.complete','pos.use'
));

create table public.quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  quote_number text not null unique check (quote_number ~ '^(LON|REG)-QUO-[0-9]{6,}$'),
  location_id uuid not null references public.locations(id),
  customer_id uuid not null references public.customers(id),
  customer_vehicle_id uuid references public.customer_vehicles(id),
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','expired','cancelled','converted_to_job')),
  customer_reference text,
  internal_notes text,
  customer_notes text,
  expiry_date date,
  customer_snapshot jsonb not null default '{}'::jsonb,
  vehicle_snapshot jsonb,
  subtotal_ex_gst numeric(14,2) not null default 0 check (subtotal_ex_gst >= 0),
  gst_amount numeric(14,2) not null default 0 check (gst_amount >= 0),
  total_incl_gst numeric(14,2),
  pricing_complete boolean not null default true,
  converted_job_id uuid,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  accepted_at timestamptz,
  converted_at timestamptz
);
create index quotes_location_status_created_idx on public.quotes(location_id,status,created_at desc,id desc);
create index quotes_customer_idx on public.quotes(customer_id,created_at desc);
create index quotes_vehicle_idx on public.quotes(customer_vehicle_id) where customer_vehicle_id is not null;

create table public.quote_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  line_position integer not null check (line_position > 0),
  line_type text not null check (line_type in ('product','labour')),
  product_id uuid references public.products(id),
  description text not null check (btrim(description) <> ''),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_incl_gst numeric(14,2) check (unit_price_incl_gst >= 0),
  line_total_incl_gst numeric(14,2) check (line_total_incl_gst >= 0),
  created_at timestamptz not null default now(),
  constraint quote_lines_type_product_check check (
    (line_type='product' and product_id is not null and quantity=trunc(quantity))
    or (line_type='labour' and product_id is null and unit_price_incl_gst is not null)
  ),
  unique (quote_id,line_position)
);
create index quote_lines_quote_idx on public.quote_lines(quote_id,line_position);
create index quote_lines_product_idx on public.quote_lines(product_id) where product_id is not null;

create table public.jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_number text not null unique check (job_number ~ '^(LON|REG)-JOB-[0-9]{6,}$'),
  location_id uuid not null references public.locations(id),
  source_quote_id uuid unique references public.quotes(id),
  source_type text not null check (source_type in ('direct','quote','pos')),
  customer_id uuid references public.customers(id),
  customer_vehicle_id uuid references public.customer_vehicles(id),
  customer_snapshot jsonb not null default '{}'::jsonb,
  vehicle_snapshot jsonb,
  status text not null default 'new' check (status in ('new','scheduled','in_progress','waiting','completed','cancelled')),
  vehicle_registration text,
  odometer integer check (odometer is null or odometer >= 0),
  customer_reference text,
  technician_notes text,
  customer_notes text,
  scheduled_at timestamptz,
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  assigned_user_id uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  subtotal_ex_gst numeric(14,2) not null default 0 check (subtotal_ex_gst >= 0),
  gst_amount numeric(14,2) not null default 0 check (gst_amount >= 0),
  total_incl_gst numeric(14,2),
  pricing_complete boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_location_status_created_idx on public.jobs(location_id,status,created_at desc,id desc);
create index jobs_customer_idx on public.jobs(customer_id,created_at desc) where customer_id is not null;
create index jobs_vehicle_idx on public.jobs(customer_vehicle_id) where customer_vehicle_id is not null;

create table public.job_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  line_position integer not null check (line_position > 0),
  line_type text not null check (line_type in ('product','labour')),
  product_id uuid references public.products(id),
  used_tyre_unit_id uuid references public.used_tyre_units(id),
  description text not null check (btrim(description) <> ''),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price_incl_gst numeric(14,2) check (unit_price_incl_gst >= 0),
  line_total_incl_gst numeric(14,2) check (line_total_incl_gst >= 0),
  cost_basis numeric(14,4),
  inventory_movement_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint job_lines_type_product_check check (
    (line_type='product' and product_id is not null and quantity=trunc(quantity))
    or (line_type='labour' and product_id is null and used_tyre_unit_id is null and unit_price_incl_gst is not null)
  ),
  unique (job_id,line_position)
);
create index job_lines_job_idx on public.job_lines(job_id,line_position);
create index job_lines_product_idx on public.job_lines(product_id) where product_id is not null;

create table public.commercial_action_requests (
  request_id uuid primary key,
  action text not null,
  actor_user_id uuid not null references auth.users(id),
  entity_id uuid,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index commercial_action_requests_entity_idx on public.commercial_action_requests(entity_id,action);

create table public.inventory_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  job_line_id uuid not null references public.job_lines(id),
  product_id uuid not null references public.products(id),
  used_tyre_unit_id uuid references public.used_tyre_units(id),
  location_id uuid not null references public.locations(id),
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active','consumed','released')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_lines_active_idx on public.job_lines(job_id,line_position) where is_active;
create index inventory_reservations_job_status_idx on public.inventory_reservations(job_id,status);
create index inventory_reservations_product_location_idx on public.inventory_reservations(product_id,location_id,status);
create unique index inventory_reservations_active_line_idx on public.inventory_reservations(job_line_id) where status='active';
alter table public.inventory_reservations enable row level security;
revoke all on public.inventory_reservations from public,anon,authenticated,service_role;
grant select on public.inventory_reservations to service_role;
create trigger inventory_reservations_touch_updated_at before update on public.inventory_reservations for each row execute function private.touch_updated_at();

create or replace function private.release_job_reservations(p_job_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.inventory_reservations%rowtype; b public.inventory_balances%rowtype; u public.used_tyre_units%rowtype;
begin
  for r in select * from public.inventory_reservations where job_id=p_job_id and status='active' order by product_id,id for update loop
    select * into b from public.inventory_balances where product_id=r.product_id and location_id=r.location_id for update;
    if not found or b.reserved < r.quantity then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    update public.inventory_balances set reserved=reserved-r.quantity,updated_at=now() where product_id=r.product_id and location_id=r.location_id;
    if r.used_tyre_unit_id is not null then
      select * into u from public.used_tyre_units where id=r.used_tyre_unit_id for update;
      if not found or u.product_id<>r.product_id or u.location_id<>r.location_id or u.status<>'reserved' then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
      update public.used_tyre_units set status='available',updated_at=now() where id=u.id;
    end if;
    update public.inventory_reservations set status='released' where id=r.id;
  end loop;
end;
$$;

create or replace function private.reserve_job_lines(p_job_id uuid,p_location_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare l public.job_lines%rowtype; b public.inventory_balances%rowtype; u public.used_tyre_units%rowtype;
begin
  for l in select * from public.job_lines where job_id=p_job_id and is_active and line_type='product' order by product_id,id loop
    select * into b from public.inventory_balances where product_id=l.product_id and location_id=p_location_id for update;
    if not found then raise exception 'BALANCE_NOT_FOUND' using errcode='P0002'; end if;
    if l.used_tyre_unit_id is not null then
      if l.quantity<>1 then raise exception 'USED_TYRE_QUANTITY_MUST_BE_ONE' using errcode='22023'; end if;
      select * into u from public.used_tyre_units where id=l.used_tyre_unit_id for update;
      if not found or u.product_id<>l.product_id or u.location_id<>p_location_id then raise exception 'USED_TYRE_PRODUCT_OR_LOCATION_MISMATCH' using errcode='22023'; end if;
      if u.status<>'available' then raise exception 'USED_TYRE_NOT_AVAILABLE' using errcode='23514'; end if;
      update public.used_tyre_units set status='reserved',updated_at=now() where id=u.id;
    end if;
    if b.on_hand-b.reserved < l.quantity::integer then raise exception 'INSUFFICIENT_STOCK' using errcode='23514'; end if;
    update public.inventory_balances set reserved=reserved+l.quantity::integer,updated_at=now() where product_id=l.product_id and location_id=p_location_id;
    insert into public.inventory_reservations(job_id,job_line_id,product_id,used_tyre_unit_id,location_id,quantity,created_by) values(p_job_id,l.id,l.product_id,l.used_tyre_unit_id,p_location_id,l.quantity::integer,p_actor);
  end loop;
end;
$$;
revoke execute on function private.release_job_reservations(uuid,uuid),private.reserve_job_lines(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create trigger quotes_touch_updated_at before update on public.quotes
for each row execute function private.touch_updated_at();
create trigger jobs_touch_updated_at before update on public.jobs
for each row execute function private.touch_updated_at();

alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
alter table public.jobs enable row level security;
alter table public.job_lines enable row level security;
alter table public.commercial_action_requests enable row level security;
revoke all on public.quotes,public.quote_lines,public.jobs,public.job_lines,public.commercial_action_requests from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.quotes,public.quote_lines,public.jobs,public.job_lines,public.commercial_action_requests to service_role;

create or replace function private.sales_permission(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (select private.app_has_permission(p_key));
$$;
revoke execute on function private.sales_permission(text) from public,anon,authenticated,service_role;

create or replace function private.sales_location_allowed(p_location_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select private.app_is_admin()) or p_location_id=(select private.app_user_location_id());
$$;
revoke execute on function private.sales_location_allowed(uuid) from public,anon,authenticated,service_role;

create or replace function private.sales_audit(p_event text,p_entity_type text,p_entity_id uuid,p_location_id uuid,p_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid()); role_name text;
begin
  select role into role_name from public.user_profiles where user_id=actor and active;
  if role_name is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(actor,role_name,p_location_id,p_event,p_entity_type,p_entity_id::text,coalesce(p_details,'{}'::jsonb));
end;
$$;
revoke execute on function private.sales_audit(text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function private.next_sales_number(p_location_id uuid,p_type text)
returns text language plpgsql security definer set search_path='' as $$
declare n bigint; code text; prefix text;
begin
  if p_type not in ('quote','job') then raise exception 'INVALID_DOCUMENT_TYPE' using errcode='22023'; end if;
  insert into public.document_sequences(location_id,document_type) values(p_location_id,p_type) on conflict do nothing;
  update public.document_sequences set last_number=last_number+1 where location_id=p_location_id and document_type=p_type returning last_number into n;
  select l.code into code from public.locations l where l.id=p_location_id and l.active;
  if code is null or n is null then raise exception 'LOCATION_NOT_FOUND' using errcode='P0002'; end if;
  prefix:=case when p_type='quote' then 'QUO' else 'JOB' end;
  return code||'-'||prefix||'-'||lpad(n::text,6,'0');
end;
$$;
revoke execute on function private.next_sales_number(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.create_quote(p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); qid uuid:=extensions.gen_random_uuid(); number text; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; payload_hash text; prior public.commercial_action_requests%rowtype;
begin
  if p_request_id is null or not (select private.sales_permission('quotes.create')) or not (select private.sales_location_allowed(p_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  select * into c from public.customers where id=p_customer_id and active;
  if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  if p_customer_vehicle_id is not null then
    select * into v from public.customer_vehicles where id=p_customer_vehicle_id and customer_id=p_customer_id and active;
    if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  payload_hash:=encode(extensions.digest(convert_to(coalesce(p_quote,'{}')::text||coalesce(p_lines,'[]')::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.commercial_action_requests where request_id=p_request_id;
  if found then
    if prior.action='create_quote' and prior.actor_user_id=actor and prior.payload_hash=payload_hash then return prior.result; end if;
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505';
  end if;
  number:=private.next_sales_number(p_location_id,'quote');
  insert into public.quotes(id,quote_number,location_id,customer_id,customer_vehicle_id,customer_reference,internal_notes,customer_notes,expiry_date,customer_snapshot,vehicle_snapshot,created_by)
  values(qid,number,p_location_id,p_customer_id,p_customer_vehicle_id,nullif(btrim(p_quote->>'customer_reference'),''),nullif(btrim(p_quote->>'internal_notes'),''),nullif(btrim(p_quote->>'customer_notes'),''),(p_quote->>'expiry_date')::date,to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized',case when p_customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,actor);
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      price:=product.selling_price_incl_gst; if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.quote_lines(quote_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst) values(qid,pos,'product',product.id,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total);
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.quote_lines(quote_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst) values(qid,pos,'labour',btrim(row->>'description'),qty,price,line_total);
    else raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
  end loop;
  update public.quotes set subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete where id=qid;
  result:=jsonb_build_object('quote_id',qid,'quote_number',number,'status','draft','pricing_complete',complete,'subtotal_ex_gst',case when complete then total-round(total/11,2) else null end,'gst_amount',case when complete then round(total/11,2) else null end,'total_incl_gst',case when complete then total else null end,'version',1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'create_quote',actor,qid,payload_hash,result);
  perform private.sales_audit('QUOTE_CREATED','quote',qid,p_location_id,jsonb_build_object('quote_number',number,'version',1,'pricing_complete',complete));
  return result;
end;
$$;

create or replace function public.quote_detail(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.quotes%rowtype; lines jsonb; result jsonb;
begin
  if not (select private.sales_permission('quotes.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and (select private.sales_location_allowed(location_id));
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.line_position),'[]'::jsonb) into lines from public.quote_lines l where l.quote_id=q.id;
  result:=to_jsonb(q)-'created_by'||jsonb_build_object('lines',lines,'cost_basis',null,'weighted_average_cost',null);
  return result;
end;
$$;

create or replace function public.quote_summary(p_location_id uuid default null,p_status text default null,p_cursor timestamptz default null,p_limit integer default 50)
returns table(id uuid,quote_number text,customer_id uuid,customer_name text,location_id uuid,status text,total_incl_gst numeric,pricing_complete boolean,version integer,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not (select private.sales_permission('quotes.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  return query select q.id,q.quote_number,q.customer_id,q.customer_snapshot->>'display_name',q.location_id,q.status,q.total_incl_gst,q.pricing_complete,q.version,q.created_at from public.quotes q where (p_location_id is null or q.location_id=p_location_id) and (select private.sales_location_allowed(q.location_id)) and (p_status is null or q.status=p_status) and (p_cursor is null or q.created_at<p_cursor) order by q.created_at desc,q.id desc limit p_limit;
end;
$$;

create or replace function public.transition_quote(p_quote_id uuid,p_expected_version integer,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; needs_reference boolean:=false;
begin
  if p_status not in ('sent','accepted','declined','expired','cancelled') then raise exception 'INVALID_QUOTE_TRANSITION' using errcode='22023'; end if;
  if p_status='accepted' then if not (select private.sales_permission('quotes.accept')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; else if not (select private.sales_permission('quotes.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; end if;
  select * into q from public.quotes where id=p_quote_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.version<>p_expected_version then raise exception 'QUOTE_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_status='sent' and q.status<>'draft' then raise exception 'INVALID_QUOTE_TRANSITION' using errcode='22023'; end if;
  if p_status='accepted' and q.status<>'sent' then raise exception 'INVALID_QUOTE_TRANSITION' using errcode='22023'; end if;
  if p_status in ('declined','expired','cancelled') and q.status not in ('draft','sent','accepted') then raise exception 'INVALID_QUOTE_TRANSITION' using errcode='22023'; end if;
  if p_status in ('sent','accepted') and not q.pricing_complete then raise exception 'PRICE_PENDING' using errcode='22023'; end if;
  select c.po_reference_required and nullif(btrim(q.customer_reference),'') is null into needs_reference from public.customers c where c.id=q.customer_id;
  if needs_reference and p_status in ('sent','accepted') then raise exception 'PO_REFERENCE_REQUIRED' using errcode='22023'; end if;
  update public.quotes set status=p_status,version=version+1,sent_at=case when p_status='sent' then now() else sent_at end,accepted_at=case when p_status='accepted' then now() else accepted_at end where id=q.id;
  perform private.sales_audit('QUOTE_STATUS_CHANGED','quote',q.id,q.location_id,jsonb_build_object('quote_number',q.quote_number,'status_before',q.status,'status_after',p_status,'version_before',q.version,'version_after',q.version+1));
  return jsonb_build_object('quote_id',q.id,'status',p_status,'version',q.version+1);
end;
$$;

create or replace function public.update_quote_draft(p_quote_id uuid,p_expected_version integer,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb;
begin
  if not (select private.sales_permission('quotes.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.version<>p_expected_version then raise exception 'QUOTE_VERSION_CONFLICT' using errcode='40001'; end if;
  if q.status<>'draft' then raise exception 'QUOTE_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  select * into c from public.customers where id=q.customer_id and active;
  if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  if q.customer_vehicle_id is not null then
    select * into v from public.customer_vehicles where id=q.customer_vehicle_id and customer_id=q.customer_id and active;
    if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  end if;
  delete from public.quote_lines where quote_id=q.id;
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      price:=product.selling_price_incl_gst; if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.quote_lines(quote_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst) values(q.id,pos,'product',product.id,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total);
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.quote_lines(quote_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst) values(q.id,pos,'labour',btrim(row->>'description'),qty,price,line_total);
    else raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
  end loop;
  update public.quotes set customer_reference=nullif(btrim(p_quote->>'customer_reference'),''),internal_notes=nullif(btrim(p_quote->>'internal_notes'),''),customer_notes=nullif(btrim(p_quote->>'customer_notes'),''),expiry_date=(p_quote->>'expiry_date')::date,customer_snapshot=to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized',vehicle_snapshot=case when q.customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete,version=version+1 where id=q.id;
  perform private.sales_audit('QUOTE_CHANGED','quote',q.id,q.location_id,jsonb_build_object('quote_number',q.quote_number,'version_before',q.version,'version_after',q.version+1,'pricing_complete',complete));
  result:=jsonb_build_object('quote_id',q.id,'quote_number',q.quote_number,'status','draft','pricing_complete',complete,'subtotal_ex_gst',case when complete then total-round(total/11,2) else null end,'gst_amount',case when complete then round(total/11,2) else null end,'total_incl_gst',case when complete then total else null end,'version',q.version+1);
  return result;
end;
$$;

create or replace function public.convert_quote_to_job(p_quote_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; jid uuid:=extensions.gen_random_uuid(); number text; result jsonb; prior_result jsonb; actor uuid:=(select auth.uid());
begin
  if p_request_id is null or not (select private.sales_permission('jobs.create')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  select car.result into prior_result from public.commercial_action_requests car where car.request_id=p_request_id and car.action='convert_quote'; if prior_result is not null then return prior_result; end if;
  if exists(select 1 from public.commercial_action_requests where request_id=p_request_id) then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
  select * into q from public.quotes where id=p_quote_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.version<>p_expected_version then if q.status='converted_to_job' and q.converted_job_id is not null then return jsonb_build_object('job_id',q.converted_job_id,'quote_id',q.id,'status','converted_to_job'); end if; raise exception 'QUOTE_VERSION_CONFLICT' using errcode='40001'; end if;
  if q.status<>'accepted' then raise exception 'INVALID_QUOTE_TRANSITION' using errcode='22023'; end if;
  number:=private.next_sales_number(q.location_id,'job');
  insert into public.jobs(id,job_number,location_id,source_quote_id,source_type,customer_id,customer_vehicle_id,customer_snapshot,vehicle_snapshot,customer_reference,technician_notes,customer_notes,created_by,subtotal_ex_gst,gst_amount,total_incl_gst,pricing_complete)
  values(jid,number,q.location_id,q.id,'quote',q.customer_id,q.customer_vehicle_id,q.customer_snapshot,q.vehicle_snapshot,q.customer_reference,q.internal_notes,q.customer_notes,actor,q.subtotal_ex_gst,q.gst_amount,q.total_incl_gst,q.pricing_complete);
  insert into public.job_lines(job_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst) select jid,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst from public.quote_lines where quote_id=q.id;
  perform private.reserve_job_lines(jid,q.location_id,actor);
  update public.quotes set status='converted_to_job',converted_job_id=jid,converted_at=now(),version=version+1 where id=q.id;
  result:=jsonb_build_object('job_id',jid,'job_number',number,'quote_id',q.id,'status','new');
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'convert_quote',actor,q.id,'convert:'||q.id::text,result);
  perform private.sales_audit('QUOTE_CONVERTED_TO_JOB','quote',q.id,q.location_id,jsonb_build_object('job_id',jid,'job_number',number));
  perform private.sales_audit('JOB_CREATED','job',jid,q.location_id,jsonb_build_object('source_quote_id',q.id,'job_number',number));
  return result;
end;
$$;

create or replace function public.create_job(p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); jid uuid:=extensions.gen_random_uuid(); number text; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; payload_hash text; prior public.commercial_action_requests%rowtype;
begin
  if p_request_id is null or not (select private.sales_permission('jobs.create')) or not (select private.sales_location_allowed(p_location_id)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if p_customer_id is null then
    if coalesce(p_job->>'source_type','direct') <> 'pos' or nullif(btrim(p_job->>'walk_in_label'),'') is null then raise exception 'CUSTOMER_REQUIRED' using errcode='22023'; end if;
  else
    select * into c from public.customers where id=p_customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  end if;
  if p_customer_vehicle_id is not null then
    select * into v from public.customer_vehicles where id=p_customer_vehicle_id and customer_id=p_customer_id and active;
    if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  payload_hash:=encode(extensions.digest(convert_to(coalesce(p_job,'{}')::text||coalesce(p_lines,'[]')::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.commercial_action_requests where request_id=p_request_id;
  if found then
    if prior.action='create_job' and prior.actor_user_id=actor and prior.payload_hash=payload_hash then return prior.result; end if;
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505';
  end if;
  number:=private.next_sales_number(p_location_id,'job');
  insert into public.jobs(id,job_number,location_id,source_type,customer_id,customer_vehicle_id,customer_snapshot,vehicle_snapshot,customer_reference,technician_notes,customer_notes,created_by)
  values(jid,number,p_location_id,coalesce(nullif(p_job->>'source_type',''),'direct'),p_customer_id,p_customer_vehicle_id,case when p_customer_id is null then jsonb_build_object('display_name',btrim(p_job->>'walk_in_label')) else to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized' end,case when p_customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,nullif(btrim(p_job->>'customer_reference'),''),nullif(btrim(p_job->>'technician_notes'),''),nullif(btrim(p_job->>'customer_notes'),''),actor);
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      price:=product.selling_price_incl_gst; if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.job_lines(job_id,line_position,line_type,product_id,used_tyre_unit_id,description,quantity,unit_price_incl_gst,line_total_incl_gst) values(jid,pos,'product',product.id,nullif(row->>'used_tyre_unit_id','')::uuid,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total);
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.job_lines(job_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst) values(jid,pos,'labour',btrim(row->>'description'),qty,price,line_total);
    else raise exception 'INVALID_JOB_LINE' using errcode='22023'; end if;
  end loop;
  update public.jobs set subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete where id=jid;
  perform private.reserve_job_lines(jid,p_location_id,actor);
  result:=jsonb_build_object('job_id',jid,'job_number',number,'status','new','pricing_complete',complete,'total_incl_gst',case when complete then total else null end,'version',1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'create_job',actor,jid,payload_hash,result);
  perform private.sales_audit('JOB_CREATED','job',jid,p_location_id,jsonb_build_object('job_number',number,'source_type',coalesce(nullif(p_job->>'source_type',''),'direct')));
  return result;
end;
$$;

create or replace function public.job_detail(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.jobs%rowtype; lines jsonb;
begin
  if not (select private.sales_permission('jobs.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into j from public.jobs where id=p_job_id and (select private.sales_location_allowed(location_id));
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('cost_basis',null,'reservation_status',r.status,'reserved_quantity',r.quantity) order by l.line_position),'[]'::jsonb) into lines from public.job_lines l left join lateral (select ir.status,ir.quantity from public.inventory_reservations ir where ir.job_line_id=l.id order by ir.created_at desc limit 1) r on true where l.job_id=j.id and l.is_active;
  return to_jsonb(j)-'created_by'||jsonb_build_object('lines',lines,'weighted_average_cost',null);
end;
$$;

create or replace function public.transition_job(p_job_id uuid,p_expected_version integer,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs%rowtype; allowed boolean:=false;
begin
  if p_status not in ('scheduled','in_progress','waiting','cancelled') or not (select private.sales_permission('jobs.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into j from public.jobs where id=p_job_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  allowed:=case when j.status='new' and p_status in ('scheduled','in_progress','waiting','cancelled') then true when j.status='scheduled' and p_status in ('in_progress','waiting','cancelled') then true when j.status='in_progress' and p_status in ('waiting','cancelled') then true when j.status='waiting' and p_status in ('scheduled','in_progress','cancelled') then true else false end;
  if not allowed then raise exception 'INVALID_JOB_TRANSITION' using errcode='22023'; end if;
  update public.jobs set status=p_status,version=version+1 where id=j.id;
  perform private.sales_audit('JOB_STATUS_CHANGED','job',j.id,j.location_id,jsonb_build_object('status_before',j.status,'status_after',p_status,'version_before',j.version,'version_after',j.version+1));
  return jsonb_build_object('job_id',j.id,'status',p_status,'version',j.version+1);
end;
$$;

create or replace function public.update_job(p_job_id uuid,p_expected_version integer,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); j public.jobs%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true;
begin
  if not (select private.sales_permission('jobs.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into j from public.jobs where id=p_job_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  if j.status in ('completed','cancelled') then raise exception 'JOB_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  perform private.release_job_reservations(j.id,actor); update public.job_lines set is_active=false where job_id=j.id;
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then select * into product from public.products where id=(row->>'product_id')::uuid; if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if; if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if; price:=product.selling_price_incl_gst; if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if; insert into public.job_lines(job_id,line_position,line_type,product_id,used_tyre_unit_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,is_active) values(j.id,pos,'product',product.id,nullif(row->>'used_tyre_unit_id','')::uuid,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,true) on conflict (job_id,line_position) do update set line_type=excluded.line_type,product_id=excluded.product_id,used_tyre_unit_id=excluded.used_tyre_unit_id,description=excluded.description,quantity=excluded.quantity,unit_price_incl_gst=excluded.unit_price_incl_gst,line_total_incl_gst=excluded.line_total_incl_gst,is_active=true;
    elsif row->>'line_type'='labour' then price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if; line_total:=round(qty*price,2); total:=total+line_total; insert into public.job_lines(job_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,is_active) values(j.id,pos,'labour',btrim(row->>'description'),qty,price,line_total,true) on conflict (job_id,line_position) do update set line_type=excluded.line_type,product_id=null,used_tyre_unit_id=null,description=excluded.description,quantity=excluded.quantity,unit_price_incl_gst=excluded.unit_price_incl_gst,line_total_incl_gst=excluded.line_total_incl_gst,is_active=true;
    else raise exception 'INVALID_JOB_LINE' using errcode='22023'; end if;
  end loop;
  update public.jobs set technician_notes=coalesce(nullif(btrim(p_job->>'technician_notes'),''),technician_notes),customer_notes=coalesce(nullif(btrim(p_job->>'customer_notes'),''),customer_notes),customer_reference=coalesce(nullif(btrim(p_job->>'customer_reference'),''),customer_reference),subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete,version=version+1 where id=j.id;
  perform private.reserve_job_lines(j.id,j.location_id,actor);
  perform private.sales_audit('JOB_UPDATED','job',j.id,j.location_id,jsonb_build_object('version_before',j.version,'version_after',j.version+1));
  return jsonb_build_object('job_id',j.id,'status',j.status,'pricing_complete',complete,'version',j.version+1);
end;
$$;

create or replace function public.cancel_job(p_job_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); j public.jobs%rowtype;
begin
  if not (select private.sales_permission('jobs.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into j from public.jobs where id=p_job_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  if j.status in ('completed','cancelled') then raise exception 'INVALID_JOB_TRANSITION' using errcode='22023'; end if;
  perform private.release_job_reservations(j.id,actor);
  update public.jobs set status='cancelled',version=version+1 where id=j.id;
  perform private.sales_audit('JOB_CANCELLED','job',j.id,j.location_id,jsonb_build_object('version_before',j.version,'version_after',j.version+1));
  return jsonb_build_object('job_id',j.id,'status','cancelled','version',j.version+1);
end;
$$;

create or replace function public.complete_job(p_job_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); j public.jobs%rowtype; l public.job_lines%rowtype; r public.inventory_reservations%rowtype; u public.used_tyre_units%rowtype; m record; result jsonb; prior_result jsonb; movement_request uuid; captured_cost numeric;
begin
  if p_request_id is null or not (select private.sales_permission('jobs.complete')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  select car.result into prior_result from public.commercial_action_requests car where car.request_id=p_request_id and car.action='complete_job'; if prior_result is not null then return prior_result; end if;
  if exists(select 1 from public.commercial_action_requests where request_id=p_request_id) then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
  select * into j from public.jobs where id=p_job_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.status='completed' then raise exception 'JOB_ALREADY_COMPLETED' using errcode='22023'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  if not j.pricing_complete then raise exception 'PRICE_PENDING' using errcode='22023'; end if;
  for l in select * from public.job_lines where job_id=j.id and is_active and line_type='product' order by line_position loop
    select * into r from public.inventory_reservations where job_line_id=l.id and status='active' for update;
    if not found or r.quantity<>l.quantity::integer or r.location_id<>j.location_id then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    if r.used_tyre_unit_id is distinct from l.used_tyre_unit_id then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    if r.used_tyre_unit_id is not null then
      select * into u from public.used_tyre_units where id=r.used_tyre_unit_id for update;
      if not found or u.status<>'reserved' or u.product_id<>l.product_id or u.location_id<>j.location_id then raise exception 'USED_TYRE_NOT_AVAILABLE' using errcode='23514'; end if;
      captured_cost:=u.cost_basis;
    end if;
    movement_request:=replace(md5(p_request_id::text||':'||l.line_position::text),' ','')::uuid;
    update public.inventory_balances set reserved=reserved-r.quantity,updated_at=now() where product_id=r.product_id and location_id=r.location_id and reserved>=r.quantity;
    if not found then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    select * into m from public.post_inventory_movement(movement_request,l.product_id,j.location_id,-l.quantity::integer,case when r.used_tyre_unit_id is null then 'stock_out' else 'used_unit_out' end,'Workshop job '||j.job_number,null,r.used_tyre_unit_id,'job',j.id::text,null);
    if r.used_tyre_unit_id is null then select weighted_average_cost into captured_cost from public.inventory_balances where product_id=l.product_id and location_id=j.location_id; end if;
    if r.used_tyre_unit_id is not null then update public.used_tyre_units set status='sold',updated_at=now() where id=r.used_tyre_unit_id; end if;
    update public.job_lines set inventory_movement_id=m.movement_id,cost_basis=captured_cost where id=l.id;
    update public.inventory_reservations set status='consumed' where id=r.id;
  end loop;
  update public.jobs set status='completed',completed_at=now(),version=version+1 where id=j.id;
  result:=jsonb_build_object('job_id',j.id,'status','completed','version',j.version+1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'complete_job',actor,j.id,'complete:'||j.id::text,result);
  perform private.sales_audit('JOB_COMPLETED','job',j.id,j.location_id,jsonb_build_object('job_number',j.job_number,'version_before',j.version,'version_after',j.version+1));
  return result;
end;
$$;

create or replace function public.sales_product_search(p_location_id uuid default null,p_query text default null,p_limit integer default 30)
returns table(product_id uuid,name text,part_reference text,brand_name text,pattern_name text,size_name text,tyre_condition text,selling_price_incl_gst numeric,on_hand integer,reserved integer,available integer)
language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_query,'')));
begin
  if not (select private.sales_permission('quotes.view')) and not (select private.sales_permission('jobs.view')) and not (select private.sales_permission('pos.use')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  return query select s.product_id,s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name,s.tyre_condition,s.selling_price_incl_gst,s.on_hand,s.reserved,s.available from public.inventory_product_summary s where s.active and (p_location_id is null or s.location_id=p_location_id) and (term='' or lower(concat_ws(' ',s.name,s.part_reference,s.brand_name,s.pattern_name,s.size_name)) like '%'||term||'%') and (p_location_id is null or (select private.sales_location_allowed(s.location_id))) order by s.name,s.product_id limit p_limit;
end;
$$;

create or replace function public.job_summary(p_location_id uuid default null,p_status text default null,p_query text default null,p_limit integer default 100)
returns table(id uuid,job_number text,customer_id uuid,customer_name text,vehicle_registration text,location_id uuid,status text,total_incl_gst numeric,pricing_complete boolean,version integer,opened_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(btrim(coalesce(p_query,'')));
begin
  if not (select private.sales_permission('jobs.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT' using errcode='22023'; end if;
  return query select j.id,j.job_number,j.customer_id,j.customer_snapshot->>'display_name',j.vehicle_snapshot->>'registration',j.location_id,j.status,j.total_incl_gst,j.pricing_complete,j.version,j.opened_at from public.jobs j where (p_location_id is null or j.location_id=p_location_id) and (select private.sales_location_allowed(j.location_id)) and (p_status is null or j.status=p_status) and (term='' or lower(concat_ws(' ',j.job_number,j.customer_snapshot->>'display_name',j.vehicle_snapshot->>'registration')) like '%'||term||'%') order by j.opened_at desc,j.id desc limit p_limit;
end;
$$;

revoke execute on function public.create_quote(uuid,uuid,uuid,uuid,jsonb,jsonb),public.quote_detail(uuid),public.quote_summary(uuid,text,timestamptz,integer),public.transition_quote(uuid,integer,text),public.update_quote_draft(uuid,integer,jsonb,jsonb),public.convert_quote_to_job(uuid,integer,uuid),public.create_job(uuid,uuid,uuid,uuid,jsonb,jsonb),public.job_detail(uuid),public.transition_job(uuid,integer,text),public.update_job(uuid,integer,jsonb,jsonb),public.cancel_job(uuid,integer),public.complete_job(uuid,integer,uuid),public.sales_product_search(uuid,text,integer),public.job_summary(uuid,text,text,integer) from public,anon,service_role;
grant execute on function public.create_quote(uuid,uuid,uuid,uuid,jsonb,jsonb),public.quote_detail(uuid),public.quote_summary(uuid,text,timestamptz,integer),public.transition_quote(uuid,integer,text),public.update_quote_draft(uuid,integer,jsonb,jsonb),public.convert_quote_to_job(uuid,integer,uuid),public.create_job(uuid,uuid,uuid,uuid,jsonb,jsonb),public.job_detail(uuid),public.transition_job(uuid,integer,text),public.update_job(uuid,integer,jsonb,jsonb),public.cancel_job(uuid,integer),public.complete_job(uuid,integer,uuid),public.sales_product_search(uuid,text,integer),public.job_summary(uuid,text,text,integer) to authenticated;
