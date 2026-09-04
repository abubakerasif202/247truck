-- Phase 3A: global customer/fleet identities, contacts, vehicles and secure RPCs.

alter table public.manager_permissions drop constraint manager_permissions_permission_key_check;
alter table public.manager_permissions add constraint manager_permissions_permission_key_check check (permission_key in (
  'inventory.view','inventory.stock_in','inventory.stock_out','inventory.adjust','inventory.view_cost',
  'inventory.edit_global_price','inventory.transfer_request','purchasing.view','purchasing.create_po',
  'purchasing.submit_po','purchasing.receive_po','reports.view_inventory_value',
  'customers.view','customers.create','customers.edit','customers.manage_contacts','customers.manage_vehicles'
));

create table public.customer_number_sequence (
  singleton boolean primary key default true check (singleton),
  last_number bigint not null default 0 check (last_number >= 0)
);
insert into public.customer_number_sequence(singleton,last_number) values(true,0);

create table public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_number text not null unique check (customer_number ~ '^CUS-[0-9]{6,}$'),
  customer_type text not null check (customer_type in ('individual','business')),
  display_name text not null check (btrim(display_name) <> ''),
  first_name text,
  last_name text,
  company_name text,
  legal_name text,
  abn text,
  abn_normalized text,
  mobile text,
  mobile_normalized text,
  phone text,
  phone_normalized text,
  email text,
  email_normalized text,
  billing_email text,
  billing_email_normalized text,
  accounts_email text,
  accounts_email_normalized text,
  street_address text,
  suburb text not null check (btrim(suburb) <> ''),
  state text not null check (btrim(state) <> ''),
  postcode text not null check (btrim(postcode) <> ''),
  payment_terms text not null default 'due_on_receipt' check (payment_terms in ('due_on_receipt','7_days','14_days','30_days')),
  po_reference_required boolean not null default false,
  notes text,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint customers_type_fields_check check (
    (customer_type='individual' and mobile is not null and btrim(mobile)<>'') or
    (customer_type='business' and company_name is not null and btrim(company_name)<>'' and abn_normalized is not null and abn_normalized<>'')
  )
);

create table public.customer_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  first_name text not null check (btrim(first_name)<>''),
  last_name text,
  role_title text,
  mobile text,
  mobile_normalized text,
  phone text,
  phone_normalized text,
  email text,
  email_normalized text,
  primary_contact boolean not null default false,
  billing_contact boolean not null default false,
  notes text,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0)
);

create unique index customer_contacts_one_active_primary_idx on public.customer_contacts(customer_id)
  where primary_contact and active;
create index customer_contacts_customer_idx on public.customer_contacts(customer_id,active);
create index customer_contacts_email_idx on public.customer_contacts(email_normalized) where email_normalized is not null;
create index customer_contacts_mobile_idx on public.customer_contacts(mobile_normalized) where mobile_normalized is not null;

create table public.customer_vehicles (
  id uuid primary key default extensions.gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  vehicle_type text not null check (vehicle_type in ('truck','trailer','other')),
  registration text not null check (btrim(registration)<>''),
  registration_normalized text not null check (registration_normalized<>''),
  fleet_number text,
  fleet_number_normalized text,
  make text,
  model text,
  year integer check (year is null or year between 1900 and 2200),
  vin text,
  body_description text,
  axle_configuration_notes text,
  tyre_notes text,
  notes text,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0)
);
create index customer_vehicles_customer_idx on public.customer_vehicles(customer_id,active);
create index customer_vehicles_registration_idx on public.customer_vehicles(registration_normalized);
create index customer_vehicles_fleet_number_idx on public.customer_vehicles(fleet_number_normalized) where fleet_number_normalized is not null;

create table public.customer_rpc_requests (
  request_id uuid primary key,
  action text not null,
  actor_user_id uuid not null references auth.users(id),
  payload_hash text not null,
  entity_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index customer_rpc_requests_actor_idx on public.customer_rpc_requests(actor_user_id,created_at desc);

create trigger customers_touch_updated_at before update on public.customers
for each row execute function private.touch_updated_at();
create trigger customer_contacts_touch_updated_at before update on public.customer_contacts
for each row execute function private.touch_updated_at();
create trigger customer_vehicles_touch_updated_at before update on public.customer_vehicles
for each row execute function private.touch_updated_at();

alter table public.customer_number_sequence enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.customer_vehicles enable row level security;
alter table public.customer_rpc_requests enable row level security;
revoke all on public.customer_number_sequence,public.customers,public.customer_contacts,public.customer_vehicles,public.customer_rpc_requests from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.customers,public.customer_contacts,public.customer_vehicles to service_role;
grant select,insert,update,delete on public.customer_rpc_requests to service_role;
grant select,update on public.customer_number_sequence to service_role;

create or replace function private.customer_permission(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and (select private.app_has_permission(p_key));
$$;
revoke execute on function private.customer_permission(text) from public,anon,authenticated,service_role;

create or replace function private.customer_text(p_value text)
returns text language sql immutable security invoker set search_path='' as $$
  select nullif(pg_catalog.btrim(p_value),'');
$$;
revoke execute on function private.customer_text(text) from public,anon,authenticated,service_role;

create or replace function private.customer_digits(p_value text)
returns text language sql immutable security invoker set search_path='' as $$
  with normalized as (
    select nullif(pg_catalog.regexp_replace(coalesce(p_value,''),'[^0-9]','','g'),'') as digits
  )
  select case
    when digits like '61%' and length(digits)=11 then '0'||substr(digits,3)
    else digits
  end
  from normalized;
$$;
revoke execute on function private.customer_digits(text) from public,anon,authenticated,service_role;

create or replace function private.customer_email(p_value text)
returns text language sql immutable security invoker set search_path='' as $$
  select pg_catalog.lower(private.customer_text(p_value));
$$;
revoke execute on function private.customer_email(text) from public,anon,authenticated,service_role;

create or replace function private.customer_vehicle_key(p_value text)
returns text language sql immutable security invoker set search_path='' as $$
  select nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_value,''),'[^A-Za-z0-9]','','g')),'');
$$;
revoke execute on function private.customer_vehicle_key(text) from public,anon,authenticated,service_role;

create or replace function private.customer_audit(p_event text,p_entity_type text,p_entity_id uuid,p_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_role text; v_location uuid;
begin
  select role,location_id into v_role,v_location from public.user_profiles where user_id=v_actor and active;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(v_actor,v_role,case when v_role='manager' then v_location end,p_event,p_entity_type,p_entity_id::text,coalesce(p_details,'{}'::jsonb));
end;
$$;
revoke execute on function private.customer_audit(text,text,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function private.customer_validate(p jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare t text:=pg_catalog.lower(private.customer_text(p->>'customer_type')); d text:=private.customer_text(p->>'display_name'); term text:=pg_catalog.lower(coalesce(private.customer_text(p->>'payment_terms'),'due_on_receipt'));
begin
  if t not in ('individual','business') then raise exception 'INVALID_CUSTOMER_TYPE' using errcode='22023'; end if;
  if d is null then raise exception 'CUSTOMER_NAME_REQUIRED' using errcode='22023'; end if;
  if private.customer_text(p->>'suburb') is null or private.customer_text(p->>'state') is null or private.customer_text(p->>'postcode') is null then raise exception 'CUSTOMER_ADDRESS_REQUIRED' using errcode='22023'; end if;
  if term not in ('due_on_receipt','7_days','14_days','30_days') then raise exception 'INVALID_PAYMENT_TERMS' using errcode='22023'; end if;
  if t='individual' and private.customer_text(p->>'mobile') is null then raise exception 'CUSTOMER_MOBILE_REQUIRED' using errcode='22023'; end if;
  if t='business' and private.customer_text(p->>'company_name') is null then raise exception 'CUSTOMER_COMPANY_REQUIRED' using errcode='22023'; end if;
  if t='business' and private.customer_digits(p->>'abn') is null then raise exception 'CUSTOMER_ABN_REQUIRED' using errcode='22023'; end if;
  return p || jsonb_build_object('customer_type',t,'display_name',d,'payment_terms',term);
end;
$$;
revoke execute on function private.customer_validate(jsonb) from public,anon,authenticated,service_role;

create or replace function public.create_customer(p_request_id uuid,p_customer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; actor uuid:=(select auth.uid()); h text; prior record; n bigint; id uuid; result jsonb; warnings jsonb:='[]'::jsonb; v_phone text; v_email text; v_abn text;
begin
  if p_request_id is null or not (select private.customer_permission('customers.create')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  p:=private.customer_validate(coalesce(p_customer,'{}'::jsonb));
  h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('customer-request:'||p_request_id::text,0));
  select * into prior from public.customer_rpc_requests where request_id=p_request_id;
  if found then
    if prior.action<>'create_customer' or prior.actor_user_id<>actor or prior.payload_hash<>h then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
    return prior.result;
  end if;
  v_phone:=coalesce(private.customer_digits(p->>'mobile'),private.customer_digits(p->>'phone'));
  v_email:=coalesce(private.customer_email(p->>'email'),private.customer_email(p->>'billing_email'));
  v_abn:=private.customer_digits(p->>'abn');
  if v_phone is not null and exists(select 1 from public.customers c where c.mobile_normalized=v_phone or c.phone_normalized=v_phone) then warnings:=warnings||jsonb_build_array('MATCHING_MOBILE'); end if;
  if v_email is not null and exists(select 1 from public.customers c where c.email_normalized=v_email or c.billing_email_normalized=v_email or c.accounts_email_normalized=v_email) then warnings:=warnings||jsonb_build_array('MATCHING_EMAIL'); end if;
  if v_abn is not null and exists(select 1 from public.customers c where c.abn_normalized=v_abn) then warnings:=warnings||jsonb_build_array('MATCHING_ABN'); end if;
  if exists(select 1 from public.customers c where lower(c.display_name)=lower(p->>'display_name')) then warnings:=warnings||jsonb_build_array('MATCHING_NAME'); end if;
  update public.customer_number_sequence set last_number=last_number+1 where singleton returning last_number into n;
  insert into public.customers(customer_number,customer_type,display_name,first_name,last_name,company_name,legal_name,abn,abn_normalized,mobile,mobile_normalized,phone,phone_normalized,email,email_normalized,billing_email,billing_email_normalized,accounts_email,accounts_email_normalized,street_address,suburb,state,postcode,payment_terms,po_reference_required,notes,created_by)
  values('CUS-'||lpad(n::text,6,'0'),p->>'customer_type',p->>'display_name',private.customer_text(p->>'first_name'),private.customer_text(p->>'last_name'),private.customer_text(p->>'company_name'),private.customer_text(p->>'legal_name'),private.customer_text(p->>'abn'),v_abn,private.customer_text(p->>'mobile'),private.customer_digits(p->>'mobile'),private.customer_text(p->>'phone'),private.customer_digits(p->>'phone'),private.customer_email(p->>'email'),private.customer_email(p->>'email'),private.customer_email(p->>'billing_email'),private.customer_email(p->>'billing_email'),private.customer_email(p->>'accounts_email'),private.customer_email(p->>'accounts_email'),private.customer_text(p->>'street_address'),private.customer_text(p->>'suburb'),upper(private.customer_text(p->>'state')),private.customer_text(p->>'postcode'),p->>'payment_terms',coalesce((p->>'po_reference_required')::boolean,false),private.customer_text(p->>'notes'),actor)
  returning customers.id into id;
  result:=jsonb_build_object('customer_id',id,'customer_number','CUS-'||lpad(n::text,6,'0'),'warnings',warnings);
  insert into public.customer_rpc_requests(request_id,action,actor_user_id,payload_hash,entity_id,result) values(p_request_id,'create_customer',actor,h,id,result);
  perform private.customer_audit('CUSTOMER_CREATED','customer',id,jsonb_build_object('customer_number',result->>'customer_number','customer_type',p->>'customer_type','warnings',warnings));
  return result;
end;
$$;

create or replace function public.update_customer(p_customer_id uuid,p_expected_version integer,p_customer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; old public.customers%rowtype; new_version integer;
begin
  if not (select private.customer_permission('customers.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  p:=private.customer_validate(coalesce(p_customer,'{}'::jsonb));
  select * into old from public.customers where id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  if old.version<>p_expected_version then raise exception 'CUSTOMER_VERSION_CONFLICT' using errcode='40001'; end if;
  update public.customers set customer_type=p->>'customer_type',display_name=p->>'display_name',first_name=private.customer_text(p->>'first_name'),last_name=private.customer_text(p->>'last_name'),company_name=private.customer_text(p->>'company_name'),legal_name=private.customer_text(p->>'legal_name'),abn=private.customer_text(p->>'abn'),abn_normalized=private.customer_digits(p->>'abn'),mobile=private.customer_text(p->>'mobile'),mobile_normalized=private.customer_digits(p->>'mobile'),phone=private.customer_text(p->>'phone'),phone_normalized=private.customer_digits(p->>'phone'),email=private.customer_email(p->>'email'),email_normalized=private.customer_email(p->>'email'),billing_email=private.customer_email(p->>'billing_email'),billing_email_normalized=private.customer_email(p->>'billing_email'),accounts_email=private.customer_email(p->>'accounts_email'),accounts_email_normalized=private.customer_email(p->>'accounts_email'),street_address=private.customer_text(p->>'street_address'),suburb=private.customer_text(p->>'suburb'),state=upper(private.customer_text(p->>'state')),postcode=private.customer_text(p->>'postcode'),payment_terms=p->>'payment_terms',po_reference_required=coalesce((p->>'po_reference_required')::boolean,false),notes=private.customer_text(p->>'notes'),version=version+1 where id=p_customer_id returning version into new_version;
  perform private.customer_audit('CUSTOMER_UPDATED','customer',p_customer_id,jsonb_build_object('customer_number',old.customer_number,'version_before',old.version,'version_after',new_version));
  return jsonb_build_object('customer_id',p_customer_id,'version',new_version);
end;
$$;

create or replace function public.set_customer_active(p_customer_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.customers%rowtype; v integer;
begin
  if not (select private.customer_permission('customers.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into old from public.customers where id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  update public.customers set active=p_active,version=version+1 where id=p_customer_id returning version into v;
  perform private.customer_audit(case when p_active then 'CUSTOMER_REACTIVATED' else 'CUSTOMER_ARCHIVED' end,'customer',p_customer_id,jsonb_build_object('customer_number',old.customer_number,'active_before',old.active,'active_after',p_active));
  return jsonb_build_object('customer_id',p_customer_id,'active',p_active,'version',v);
end;
$$;

create or replace function public.get_customer(p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.customers%rowtype;
begin
  if not (select private.customer_permission('customers.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into c from public.customers where id=p_customer_id;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  return to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized'||jsonb_build_object(
    'contacts',(select coalesce(jsonb_agg(to_jsonb(x)-'mobile_normalized'-'phone_normalized'-'email_normalized' order by x.primary_contact desc,x.first_name,x.id),'[]'::jsonb) from public.customer_contacts x where x.customer_id=c.id),
    'vehicles',(select coalesce(jsonb_agg(to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' order by v.active desc,v.registration,v.id),'[]'::jsonb) from public.customer_vehicles v where v.customer_id=c.id)
  );
end;
$$;

create or replace function public.search_customers(p_query text default '',p_filter text default 'all',p_limit integer default 50)
returns table(id uuid,customer_number text,customer_type text,display_name text,phone text,payment_terms text,active boolean,vehicle_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare q text:=lower(btrim(coalesce(p_query,''))); digits text:=private.customer_digits(p_query); vehicle_key text:=private.customer_vehicle_key(p_query);
begin
  if not (select private.customer_permission('customers.view')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_filter not in ('all','individual','business','active','archived') or p_limit not between 1 and 100 then raise exception 'INVALID_CUSTOMER_FILTER' using errcode='22023'; end if;
  return query select c.id,c.customer_number,c.customer_type,c.display_name,coalesce(c.mobile,c.phone),c.payment_terms,c.active,(select count(*) from public.customer_vehicles v where v.customer_id=c.id and v.active)
  from public.customers c where
    (p_filter='all' or p_filter=c.customer_type or (p_filter='active' and c.active) or (p_filter='archived' and not c.active)) and
    (q='' or lower(c.customer_number) like '%'||q||'%' or lower(c.display_name) like '%'||q||'%' or lower(coalesce(c.company_name,'')) like '%'||q||'%' or lower(coalesce(c.email_normalized,'')) like '%'||q||'%' or lower(coalesce(c.billing_email_normalized,'')) like '%'||q||'%' or lower(coalesce(c.accounts_email_normalized,'')) like '%'||q||'%' or (digits is not null and (c.abn_normalized like '%'||digits||'%' or c.mobile_normalized like '%'||digits||'%' or c.phone_normalized like '%'||digits||'%')) or exists(select 1 from public.customer_contacts ct where ct.customer_id=c.id and ct.active and (lower(coalesce(ct.email_normalized,'')) like '%'||q||'%' or (digits is not null and (ct.mobile_normalized like '%'||digits||'%' or ct.phone_normalized like '%'||digits||'%')))) or exists(select 1 from public.customer_vehicles v where v.customer_id=c.id and v.active and (v.registration_normalized like '%'||vehicle_key||'%' or lower(coalesce(v.fleet_number_normalized,'')) like '%'||q||'%')))
  order by c.active desc,c.display_name,c.customer_number limit p_limit;
end;
$$;

create or replace function public.list_customers(p_filter text default 'all',p_limit integer default 50)
returns table(id uuid,customer_number text,customer_type text,display_name text,phone text,payment_terms text,active boolean,vehicle_count bigint)
language sql stable security invoker set search_path='' as $$ select * from public.search_customers('',p_filter,p_limit); $$;

create or replace function public.add_customer_contact(p_customer_id uuid,p_contact jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare id uuid; primary_flag boolean:=coalesce((p_contact->>'primary_contact')::boolean,false); first text:=private.customer_text(p_contact->>'first_name');
begin
  if not (select private.customer_permission('customers.manage_contacts')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if first is null then raise exception 'CONTACT_FIRST_NAME_REQUIRED' using errcode='22023'; end if;
  if not exists(select 1 from public.customers where customers.id=p_customer_id and customer_type='business') then raise exception 'BUSINESS_CUSTOMER_REQUIRED' using errcode='22023'; end if;
  if primary_flag and exists(select 1 from public.customer_contacts where customer_id=p_customer_id and primary_contact and active) then raise exception 'PRIMARY_CONTACT_EXISTS' using errcode='23505'; end if;
  insert into public.customer_contacts(customer_id,first_name,last_name,role_title,mobile,mobile_normalized,phone,phone_normalized,email,email_normalized,primary_contact,billing_contact,notes,created_by)
  values(p_customer_id,first,private.customer_text(p_contact->>'last_name'),private.customer_text(p_contact->>'role_title'),private.customer_text(p_contact->>'mobile'),private.customer_digits(p_contact->>'mobile'),private.customer_text(p_contact->>'phone'),private.customer_digits(p_contact->>'phone'),private.customer_email(p_contact->>'email'),private.customer_email(p_contact->>'email'),primary_flag,coalesce((p_contact->>'billing_contact')::boolean,false),private.customer_text(p_contact->>'notes'),auth.uid()) returning customer_contacts.id into id;
  perform private.customer_audit('CUSTOMER_CONTACT_CREATED','customer_contact',id,jsonb_build_object('customer_id',p_customer_id,'primary_contact',primary_flag));
  return jsonb_build_object('contact_id',id);
end;
$$;

create or replace function public.update_customer_contact(p_contact_id uuid,p_contact jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.customer_contacts%rowtype; primary_flag boolean; v integer;
begin
  if not (select private.customer_permission('customers.manage_contacts')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into old from public.customer_contacts where id=p_contact_id for update;
  if not found then raise exception 'CONTACT_NOT_FOUND' using errcode='P0002'; end if;
  primary_flag:=case when p_contact?'primary_contact' then (p_contact->>'primary_contact')::boolean else old.primary_contact end;
  if primary_flag and old.active and exists(select 1 from public.customer_contacts where customer_id=old.customer_id and id<>old.id and primary_contact and active) then raise exception 'PRIMARY_CONTACT_EXISTS' using errcode='23505'; end if;
  update public.customer_contacts set first_name=coalesce(private.customer_text(p_contact->>'first_name'),old.first_name),last_name=case when p_contact?'last_name' then private.customer_text(p_contact->>'last_name') else old.last_name end,role_title=case when p_contact?'role_title' then private.customer_text(p_contact->>'role_title') else old.role_title end,mobile=case when p_contact?'mobile' then private.customer_text(p_contact->>'mobile') else old.mobile end,mobile_normalized=case when p_contact?'mobile' then private.customer_digits(p_contact->>'mobile') else old.mobile_normalized end,phone=case when p_contact?'phone' then private.customer_text(p_contact->>'phone') else old.phone end,phone_normalized=case when p_contact?'phone' then private.customer_digits(p_contact->>'phone') else old.phone_normalized end,email=case when p_contact?'email' then private.customer_email(p_contact->>'email') else old.email end,email_normalized=case when p_contact?'email' then private.customer_email(p_contact->>'email') else old.email_normalized end,primary_contact=primary_flag,billing_contact=case when p_contact?'billing_contact' then (p_contact->>'billing_contact')::boolean else old.billing_contact end,notes=case when p_contact?'notes' then private.customer_text(p_contact->>'notes') else old.notes end,version=version+1 where id=p_contact_id returning version into v;
  perform private.customer_audit('CUSTOMER_CONTACT_UPDATED','customer_contact',p_contact_id,jsonb_build_object('customer_id',old.customer_id,'version_before',old.version,'version_after',v)); return jsonb_build_object('contact_id',p_contact_id,'version',v);
end;
$$;

create or replace function public.archive_customer_contact(p_contact_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.customer_contacts%rowtype;
begin
  if not (select private.customer_permission('customers.manage_contacts')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  update public.customer_contacts set active=false,primary_contact=false,version=version+1 where id=p_contact_id returning * into c;
  if not found then raise exception 'CONTACT_NOT_FOUND' using errcode='P0002'; end if;
  perform private.customer_audit('CUSTOMER_CONTACT_ARCHIVED','customer_contact',p_contact_id,jsonb_build_object('customer_id',c.customer_id)); return jsonb_build_object('contact_id',p_contact_id,'active',false);
end;
$$;

create or replace function public.add_customer_vehicle(p_customer_id uuid,p_vehicle jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare id uuid; t text:=lower(private.customer_text(p_vehicle->>'vehicle_type')); reg text:=private.customer_text(p_vehicle->>'registration');
begin
  if not (select private.customer_permission('customers.manage_vehicles')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if t not in ('truck','trailer','other') then raise exception 'INVALID_VEHICLE_TYPE' using errcode='22023'; end if;
  if reg is null then raise exception 'VEHICLE_REGISTRATION_REQUIRED' using errcode='22023'; end if;
  if not exists(select 1 from public.customers where customers.id=p_customer_id) then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.customer_vehicles(customer_id,vehicle_type,registration,registration_normalized,fleet_number,fleet_number_normalized,make,model,year,vin,body_description,axle_configuration_notes,tyre_notes,notes,created_by)
  values(p_customer_id,t,upper(reg),private.customer_vehicle_key(reg),private.customer_text(p_vehicle->>'fleet_number'),lower(private.customer_text(p_vehicle->>'fleet_number')),private.customer_text(p_vehicle->>'make'),private.customer_text(p_vehicle->>'model'),(p_vehicle->>'year')::integer,private.customer_text(p_vehicle->>'vin'),private.customer_text(p_vehicle->>'body_description'),private.customer_text(p_vehicle->>'axle_configuration_notes'),private.customer_text(p_vehicle->>'tyre_notes'),private.customer_text(p_vehicle->>'notes'),auth.uid()) returning customer_vehicles.id into id;
  perform private.customer_audit('CUSTOMER_VEHICLE_CREATED','customer_vehicle',id,jsonb_build_object('customer_id',p_customer_id,'vehicle_type',t,'registration',upper(reg))); return jsonb_build_object('vehicle_id',id);
end;
$$;

create or replace function public.update_customer_vehicle(p_vehicle_id uuid,p_vehicle jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.customer_vehicles%rowtype; t text; reg text; v integer;
begin
  if not (select private.customer_permission('customers.manage_vehicles')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into old from public.customer_vehicles where id=p_vehicle_id for update;
  if not found then raise exception 'VEHICLE_NOT_FOUND' using errcode='P0002'; end if;
  t:=coalesce(lower(private.customer_text(p_vehicle->>'vehicle_type')),old.vehicle_type); reg:=coalesce(private.customer_text(p_vehicle->>'registration'),old.registration);
  if t not in ('truck','trailer','other') then raise exception 'INVALID_VEHICLE_TYPE' using errcode='22023'; end if;
  update public.customer_vehicles set vehicle_type=t,registration=upper(reg),registration_normalized=private.customer_vehicle_key(reg),fleet_number=case when p_vehicle?'fleet_number' then private.customer_text(p_vehicle->>'fleet_number') else old.fleet_number end,fleet_number_normalized=case when p_vehicle?'fleet_number' then lower(private.customer_text(p_vehicle->>'fleet_number')) else old.fleet_number_normalized end,make=case when p_vehicle?'make' then private.customer_text(p_vehicle->>'make') else old.make end,model=case when p_vehicle?'model' then private.customer_text(p_vehicle->>'model') else old.model end,year=case when p_vehicle?'year' then (p_vehicle->>'year')::integer else old.year end,vin=case when p_vehicle?'vin' then private.customer_text(p_vehicle->>'vin') else old.vin end,body_description=case when p_vehicle?'body_description' then private.customer_text(p_vehicle->>'body_description') else old.body_description end,axle_configuration_notes=case when p_vehicle?'axle_configuration_notes' then private.customer_text(p_vehicle->>'axle_configuration_notes') else old.axle_configuration_notes end,tyre_notes=case when p_vehicle?'tyre_notes' then private.customer_text(p_vehicle->>'tyre_notes') else old.tyre_notes end,notes=case when p_vehicle?'notes' then private.customer_text(p_vehicle->>'notes') else old.notes end,version=version+1 where id=p_vehicle_id returning version into v;
  perform private.customer_audit('CUSTOMER_VEHICLE_UPDATED','customer_vehicle',p_vehicle_id,jsonb_build_object('customer_id',old.customer_id,'version_before',old.version,'version_after',v)); return jsonb_build_object('vehicle_id',p_vehicle_id,'version',v);
end;
$$;

create or replace function public.archive_customer_vehicle(p_vehicle_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.customer_vehicles%rowtype;
begin
  if not (select private.customer_permission('customers.manage_vehicles')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  update public.customer_vehicles set active=false,version=version+1 where id=p_vehicle_id returning * into v;
  if not found then raise exception 'VEHICLE_NOT_FOUND' using errcode='P0002'; end if;
  perform private.customer_audit('CUSTOMER_VEHICLE_ARCHIVED','customer_vehicle',p_vehicle_id,jsonb_build_object('customer_id',v.customer_id,'registration',v.registration)); return jsonb_build_object('vehicle_id',p_vehicle_id,'active',false);
end;
$$;

revoke execute on function public.create_customer(uuid,jsonb),public.update_customer(uuid,integer,jsonb),public.set_customer_active(uuid,boolean),public.get_customer(uuid),public.search_customers(text,text,integer),public.list_customers(text,integer),public.add_customer_contact(uuid,jsonb),public.update_customer_contact(uuid,jsonb),public.archive_customer_contact(uuid),public.add_customer_vehicle(uuid,jsonb),public.update_customer_vehicle(uuid,jsonb),public.archive_customer_vehicle(uuid) from public,anon,service_role;
grant execute on function public.create_customer(uuid,jsonb),public.update_customer(uuid,integer,jsonb),public.set_customer_active(uuid,boolean),public.get_customer(uuid),public.search_customers(text,text,integer),public.list_customers(text,integer),public.add_customer_contact(uuid,jsonb),public.update_customer_contact(uuid,jsonb),public.archive_customer_contact(uuid),public.add_customer_vehicle(uuid,jsonb),public.update_customer_vehicle(uuid,jsonb),public.archive_customer_vehicle(uuid) to authenticated;
