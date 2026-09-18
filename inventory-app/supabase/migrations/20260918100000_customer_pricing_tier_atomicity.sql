-- Customer pricing tier is customer-master state. Keep it in the create/update
-- transaction so a successful customer action cannot leave a stale version or
-- partially-applied tier. Historical request hashes retain their pre-tier
-- canonical payload: omitted tier values use the established safe defaults.

create or replace function public.create_customer(p_request_id uuid,p_customer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; actor uuid:=(select auth.uid()); h text; prior record; n bigint; id uuid; result jsonb; warnings jsonb:='[]'::jsonb; v_phone text; v_email text; v_abn text; v_pricing_tier text;
begin
  if p_request_id is null or not (select private.customer_permission('customers.create')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  p:=private.customer_validate(coalesce(p_customer,'{}'::jsonb));
  h:=encode(extensions.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
  v_pricing_tier:=case when p ? 'pricing_tier' then lower(nullif(btrim(p->>'pricing_tier'),'')) else case when p->>'customer_type'='business' then 'wholesale' else 'retail' end end;
  if v_pricing_tier not in ('retail','wholesale') then raise exception 'INVALID_PRICING_TIER' using errcode='22023'; end if;
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
  insert into public.customers(customer_number,customer_type,display_name,first_name,last_name,company_name,legal_name,abn,abn_normalized,mobile,mobile_normalized,phone,phone_normalized,email,email_normalized,billing_email,billing_email_normalized,accounts_email,accounts_email_normalized,street_address,suburb,state,postcode,payment_terms,pricing_tier,po_reference_required,notes,created_by)
  values('CUS-'||lpad(n::text,6,'0'),p->>'customer_type',p->>'display_name',private.customer_text(p->>'first_name'),private.customer_text(p->>'last_name'),private.customer_text(p->>'company_name'),private.customer_text(p->>'legal_name'),private.customer_text(p->>'abn'),v_abn,private.customer_text(p->>'mobile'),private.customer_digits(p->>'mobile'),private.customer_text(p->>'phone'),private.customer_digits(p->>'phone'),private.customer_email(p->>'email'),private.customer_email(p->>'email'),private.customer_email(p->>'billing_email'),private.customer_email(p->>'billing_email'),private.customer_email(p->>'accounts_email'),private.customer_email(p->>'accounts_email'),private.customer_text(p->>'street_address'),private.customer_text(p->>'suburb'),upper(private.customer_text(p->>'state')),private.customer_text(p->>'postcode'),p->>'payment_terms',v_pricing_tier,coalesce((p->>'po_reference_required')::boolean,false),private.customer_text(p->>'notes'),actor)
  returning customers.id into id;
  result:=jsonb_build_object('customer_id',id,'customer_number','CUS-'||lpad(n::text,6,'0'),'pricing_tier',v_pricing_tier,'warnings',warnings);
  insert into public.customer_rpc_requests(request_id,action,actor_user_id,payload_hash,entity_id,result) values(p_request_id,'create_customer',actor,h,id,result);
  perform private.customer_audit('CUSTOMER_CREATED','customer',id,jsonb_build_object('customer_number',result->>'customer_number','customer_type',p->>'customer_type','pricing_tier',v_pricing_tier,'warnings',warnings));
  return result;
end;
$$;

create or replace function public.update_customer(p_customer_id uuid,p_expected_version integer,p_customer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; old public.customers%rowtype; new_version integer; v_pricing_tier text;
begin
  if not (select private.customer_permission('customers.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  p:=private.customer_validate(coalesce(p_customer,'{}'::jsonb));
  select * into old from public.customers where id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  if old.version<>p_expected_version then raise exception 'CUSTOMER_VERSION_CONFLICT' using errcode='40001'; end if;
  v_pricing_tier:=case when p ? 'pricing_tier' then lower(nullif(btrim(p->>'pricing_tier'),'')) else old.pricing_tier end;
  if v_pricing_tier not in ('retail','wholesale') then raise exception 'INVALID_PRICING_TIER' using errcode='22023'; end if;
  update public.customers set customer_type=p->>'customer_type',display_name=p->>'display_name',first_name=private.customer_text(p->>'first_name'),last_name=private.customer_text(p->>'last_name'),company_name=private.customer_text(p->>'company_name'),legal_name=private.customer_text(p->>'legal_name'),abn=private.customer_text(p->>'abn'),abn_normalized=private.customer_digits(p->>'abn'),mobile=private.customer_text(p->>'mobile'),mobile_normalized=private.customer_digits(p->>'mobile'),phone=private.customer_text(p->>'phone'),phone_normalized=private.customer_digits(p->>'phone'),email=private.customer_email(p->>'email'),email_normalized=private.customer_email(p->>'email'),billing_email=private.customer_email(p->>'billing_email'),billing_email_normalized=private.customer_email(p->>'billing_email'),accounts_email=private.customer_email(p->>'accounts_email'),accounts_email_normalized=private.customer_email(p->>'accounts_email'),street_address=private.customer_text(p->>'street_address'),suburb=private.customer_text(p->>'suburb'),state=upper(private.customer_text(p->>'state')),postcode=private.customer_text(p->>'postcode'),payment_terms=p->>'payment_terms',pricing_tier=v_pricing_tier,po_reference_required=coalesce((p->>'po_reference_required')::boolean,false),notes=private.customer_text(p->>'notes'),version=version+1 where id=p_customer_id returning version into new_version;
  perform private.customer_audit('CUSTOMER_UPDATED','customer',p_customer_id,jsonb_build_object('customer_number',old.customer_number,'version_before',old.version,'version_after',new_version,'pricing_tier_before',old.pricing_tier,'pricing_tier_after',v_pricing_tier));
  return jsonb_build_object('customer_id',p_customer_id,'version',new_version,'pricing_tier',v_pricing_tier);
end;
$$;

-- Legacy create-only clients can no longer set tiers after creation. New app
-- clients use the atomic RPCs above; standalone changes require edit authority.
create or replace function public.set_customer_pricing_tier(p_customer_id uuid, p_pricing_tier text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); old_tier text; role_name text;
begin
  if p_pricing_tier not in ('retail','wholesale') or not private.app_has_permission('customers.edit') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select pricing_tier into old_tier from public.customers where id=p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  update public.customers set pricing_tier=p_pricing_tier, version=version+1 where id=p_customer_id;
  select role into role_name from public.user_profiles where user_id=actor;
  insert into public.audit_events(actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details)
  values(actor,role_name,null,'CUSTOMER_PRICING_TIER_CHANGED','customer',p_customer_id::text,jsonb_build_object('old_pricing_tier',old_tier,'new_pricing_tier',p_pricing_tier));
end;
$$;

drop function if exists public.list_customers(text,integer);
drop function if exists public.search_customers(text,text,integer,integer);
create function public.search_customers(p_query text default '', p_filter text default 'all', p_limit integer default 50, p_offset integer default 0)
returns table(id uuid, customer_number text, customer_type text, display_name text, phone text, payment_terms text, pricing_tier text, active boolean, vehicle_count bigint, total_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare q text := lower(btrim(coalesce(p_query, ''))); digits text := private.customer_digits(p_query); vehicle_key text := private.customer_vehicle_key(p_query);
begin
  if not ((select private.customer_permission('customers.view')) or ((select private.app_has_permission('invoices.view')) and (select private.app_has_permission('invoices.create')))) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_filter not in ('all','individual','business','active','archived') or p_limit not between 1 and 100 or p_offset < 0 then raise exception 'INVALID_CUSTOMER_FILTER' using errcode='22023'; end if;
  return query select c.id,c.customer_number,c.customer_type,c.display_name,coalesce(c.mobile,c.phone),c.payment_terms,c.pricing_tier,c.active,(select count(*) from public.customer_vehicles v where v.customer_id=c.id and v.active),count(*) over()
  from public.customers c where (p_filter='all' or p_filter=c.customer_type or (p_filter='active' and c.active) or (p_filter='archived' and not c.active)) and
    (q='' or lower(c.customer_number) like '%'||q||'%' or lower(c.display_name) like '%'||q||'%' or lower(coalesce(c.company_name,'')) like '%'||q||'%' or lower(coalesce(c.email_normalized,'')) like '%'||q||'%' or lower(coalesce(c.billing_email_normalized,'')) like '%'||q||'%' or lower(coalesce(c.accounts_email_normalized,'')) like '%'||q||'%' or (digits is not null and (c.abn_normalized like '%'||digits||'%' or c.mobile_normalized like '%'||digits||'%' or c.phone_normalized like '%'||digits||'%')) or exists(select 1 from public.customer_contacts ct where ct.customer_id=c.id and ct.active and (lower(coalesce(ct.email_normalized,'')) like '%'||q||'%' or (digits is not null and (ct.mobile_normalized like '%'||digits||'%' or ct.phone_normalized like '%'||digits||'%')))) or exists(select 1 from public.customer_vehicles v where v.customer_id=c.id and v.active and (v.registration_normalized like '%'||vehicle_key||'%' or lower(coalesce(v.fleet_number_normalized,'')) like '%'||q||'%')))
  order by c.active desc,c.display_name,c.customer_number limit p_limit offset p_offset;
end;
$$;
create function public.list_customers(p_filter text default 'all',p_limit integer default 50)
returns table(id uuid,customer_number text,customer_type text,display_name text,phone text,payment_terms text,pricing_tier text,active boolean,vehicle_count bigint)
language sql stable security invoker set search_path='' as $$ select id,customer_number,customer_type,display_name,phone,payment_terms,pricing_tier,active,vehicle_count from public.search_customers('',p_filter,p_limit,0); $$;
revoke execute on function public.search_customers(text,text,integer,integer),public.list_customers(text,integer) from public,anon,service_role;
grant execute on function public.search_customers(text,text,integer,integer),public.list_customers(text,integer) to authenticated;
