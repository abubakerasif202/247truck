-- Phase 4A primitives; public invoice creation/issue workflows remain in 4B.
alter table public.user_profiles add column finance_discount_limit_percent numeric(5,2)
  check (finance_discount_limit_percent between 0 and 100);
alter table public.quote_lines
  add column discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  add column discount_reason text,
  add column discount_actor_user_id uuid references auth.users(id) on delete restrict,
  add column discount_authorised_at timestamptz,
  add column internal_note text;
alter table public.job_lines
  add column discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  add column discount_reason text,
  add column discount_actor_user_id uuid references auth.users(id) on delete restrict,
  add column discount_authorised_at timestamptz,
  add column internal_note text;
create index quote_lines_discount_actor_idx on public.quote_lines(discount_actor_user_id);
create index job_lines_discount_actor_idx on public.job_lines(discount_actor_user_id);
alter table public.manager_permissions drop constraint manager_permissions_permission_key_check;
alter table public.manager_permissions add constraint manager_permissions_permission_key_check check (permission_key in (
  'inventory.view','inventory.stock_in','inventory.stock_out','inventory.adjust','inventory.view_cost',
  'inventory.edit_global_price','inventory.transfer_request','purchasing.view','purchasing.create_po',
  'purchasing.submit_po','purchasing.receive_po','reports.view_inventory_value',
  'customers.view','customers.create','customers.edit','customers.manage_contacts','customers.manage_vehicles',
  'quotes.view','quotes.create','quotes.edit','quotes.accept','jobs.view','jobs.create','jobs.edit','jobs.complete','pos.use',
  'invoices.view','invoices.create','invoices.edit','invoices.issue','invoices.cancel',
  'payments.view','payments.record','payments.reverse','payments.reconcile','refunds.create','receivables.view','discounts.apply','documents.send'
));

create or replace function private.finance_guard(p_permission text,p_location uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null or not private.app_has_permission(p_permission) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  if p_location is not null and (not exists(select 1 from public.locations l where l.id=p_location and l.active)
    or (not private.app_is_admin() and private.app_user_location_id() is distinct from p_location)) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  return actor;
end;
$$;
create or replace function private.finance_json_keys(p_value jsonb,p_keys text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value)<>'object'
    or exists(select 1 from pg_catalog.jsonb_object_keys(p_value) k where not k=any(p_keys)) then
    raise exception 'INVALID_FINANCE_INPUT' using errcode='22023';
  end if;
end;
$$;
create or replace function private.finance_decimal(p_value text,p_scale integer,p_precision integer)
returns numeric language plpgsql immutable set search_path='' as $$
declare value numeric;
begin
  if p_value is null or btrim(p_value) !~ '^[0-9]+(\.[0-9]+)?$'
    or length(split_part(btrim(p_value),'.',2))>p_scale or length(p_value)>40 then
    raise exception 'INVALID_DECIMAL' using errcode='22023';
  end if;
  value:=btrim(p_value)::numeric;
  if value>=power(10::numeric,p_precision-p_scale) then raise exception 'MONEY_OUT_OF_RANGE' using errcode='22003'; end if;
  return value;
end;
$$;
create or replace function private.finance_discount(p_discount text,p_reason text,p_permission text,p_location uuid)
returns numeric language plpgsql security definer set search_path='' as $$
declare amount numeric; cap numeric;
begin
  perform private.finance_guard(p_permission,p_location);
  amount:=private.finance_decimal(p_discount,2,5);
  if amount>100 then raise exception 'DISCOUNT_LIMIT_EXCEEDED' using errcode='22023'; end if;
  if amount>0 then
    perform private.finance_guard('discounts.apply',p_location);
    if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then raise exception 'DISCOUNT_REASON_REQUIRED' using errcode='22023'; end if;
    if not private.app_is_admin() then
      select p.finance_discount_limit_percent into cap from public.user_profiles p where p.user_id=(select auth.uid());
      if cap is null or amount>cap then raise exception 'DISCOUNT_LIMIT_EXCEEDED' using errcode='42501'; end if;
    end if;
  end if;
  return amount;
end;
$$;
create or replace function private.finance_request(p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.finance_action_requests%rowtype; fingerprint text; actor uuid:=(select auth.uid());
begin
  if actor is null or p_request is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-request:'||p_request::text,0));
  fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('actor',actor,'action',p_action,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.finance_action_requests r where r.request_id=p_request;
  if found then
    if prior.actor_user_id is distinct from actor or prior.action<>p_action or prior.payload_hash<>fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505';
    end if;
    return prior.result;
  end if;
  return null;
end;
$$;
create or replace function private.finance_request_finish(p_request uuid,p_action text,p_payload jsonb,p_location uuid,p_entity uuid,p_result jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.finance_action_requests(request_id,action,actor_kind,actor_user_id,location_id,entity_type,entity_id,payload_hash,result)
  values(p_request,p_action,'staff',(select auth.uid()),p_location,'finance',p_entity,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('actor',(select auth.uid()),'action',p_action,'payload',p_payload)::text,'UTF8'),'sha256'),'hex'),p_result);
end;
$$;

create or replace function private.finance_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501';
end;
$$;
create trigger finance_requests_immutable before update or delete on public.finance_action_requests for each row execute function private.finance_immutable();
create trigger invoice_costs_immutable before update or delete on public.invoice_line_costs for each row execute function private.finance_immutable();

create or replace function private.finance_invoice_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    if (new.id,new.invoice_number,new.location_id,new.customer_id,new.customer_vehicle_id,new.job_id,new.source_type,new.created_by,new.created_at)
      is distinct from (old.id,old.invoice_number,old.location_id,old.customer_id,old.customer_vehicle_id,old.job_id,old.source_type,old.created_by,old.created_at)
      or (old.first_payment_at is not null and new.first_payment_at is distinct from old.first_payment_at)
      or (old.first_issued_at is not null and new.first_issued_at is distinct from old.first_issued_at)
      or (old.status='cancelled' and new.status<>'cancelled') then
      raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501';
    end if;
    if old.first_payment_at is not null and new.current_revision_id is distinct from old.current_revision_id then
      raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501';
    end if;
  end if;
  if new.job_id is not null and not exists(select 1 from public.jobs j where j.id=new.job_id and j.location_id=new.location_id
    and j.customer_id is not distinct from new.customer_id and j.customer_vehicle_id is not distinct from new.customer_vehicle_id) then
    raise exception 'INVOICE_SOURCE_MISMATCH' using errcode='22023';
  end if;
  if new.customer_vehicle_id is not null and not exists(select 1 from public.customer_vehicles v where v.id=new.customer_vehicle_id and v.customer_id=new.customer_id) then
    raise exception 'INVOICE_SOURCE_MISMATCH' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger invoices_identity_guard before insert or update or delete on public.invoices for each row execute function private.finance_invoice_guard();
create or replace function private.finance_require_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.invoices i where i.id=new.id and i.current_revision_id is null) then
    raise exception 'INVOICE_REVISION_REQUIRED' using errcode='23514';
  end if;
  return null;
end;
$$;
create constraint trigger invoices_require_current_revision after insert or update on public.invoices
  deferrable initially deferred for each row execute function private.finance_require_revision();
create or replace function private.finance_revision_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; locked_at timestamptz;
begin
  if tg_op<>'INSERT' and old.lifecycle='issued' then raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  target:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select i.first_payment_at into locked_at from public.invoices i where i.id=target for update;
  if locked_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.id,new.invoice_id,new.revision_number) is distinct from (old.id,old.invoice_id,old.revision_number) then
    raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger invoice_revisions_guard before insert or update or delete on public.invoice_revisions for each row execute function private.finance_revision_guard();
create or replace function private.finance_line_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid; iid uuid; state text; locked_at timestamptz;
begin
  rid:=case when tg_op='DELETE' then old.revision_id else new.revision_id end;
  iid:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select i.first_payment_at into locked_at from public.invoices i where i.id=iid for update;
  select r.lifecycle into state from public.invoice_revisions r where r.id=rid and r.invoice_id=iid;
  if state='issued' or locked_at is not null then raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.id,new.invoice_id,new.revision_id) is distinct from (old.id,old.invoice_id,old.revision_id) then
    raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines for each row execute function private.finance_line_guard();

create policy finance_settings_admin_read on public.finance_settings for select to authenticated using ((select private.app_is_admin()));
create policy finance_location_settings_admin_read on public.finance_location_settings for select to authenticated using ((select private.app_is_admin()));
create policy invoices_branch_read on public.invoices for select to authenticated using (
  (select private.app_has_permission('invoices.view')) and ((select private.app_is_admin()) or location_id=(select private.app_user_location_id())));
create policy invoice_revisions_branch_read on public.invoice_revisions for select to authenticated using (exists(select 1 from public.invoices i where i.id=invoice_id));
create policy invoice_lines_branch_read on public.invoice_lines for select to authenticated using (exists(select 1 from public.invoices i where i.id=invoice_id));
create policy invoice_costs_branch_read on public.invoice_line_costs for select to authenticated using (
  (select private.app_has_permission('inventory.view_cost')) and (select private.app_has_permission('invoices.view'))
  and exists(select 1 from public.invoice_lines l join public.invoices i on i.id=l.invoice_id where l.id=invoice_line_id
    and ((select private.app_is_admin()) or i.location_id=(select private.app_user_location_id()))));
create policy financial_documents_branch_read on public.financial_documents for select to authenticated using (exists(select 1 from public.invoices i where i.id=invoice_id));

revoke execute on function private.finance_guard(text,uuid),private.finance_json_keys(jsonb,text[]),private.finance_decimal(text,integer,integer),
  private.finance_discount(text,text,text,uuid),private.finance_request(uuid,text,jsonb),private.finance_request_finish(uuid,text,jsonb,uuid,uuid,jsonb),
  private.finance_immutable(),private.finance_invoice_guard(),private.finance_require_revision(),private.finance_revision_guard(),private.finance_line_guard()
  from public,anon,authenticated,service_role;

create or replace function public.finance_settings_detail()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.app_is_admin() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  return pg_catalog.jsonb_build_object(
    'global',coalesce((select pg_catalog.jsonb_build_object('version',s.version,'business_name',s.business_name,'abn',s.abn,'address',s.address,'phone',s.phone,'shared_email',s.shared_email,'logo_asset_path',s.logo_asset_path,'logo_sha256',s.logo_sha256,'bank_instructions',s.bank_instructions,'invoice_footer',s.invoice_footer,
      'stripe_enabled',s.stripe_enabled,'email_automation_enabled',s.email_automation_enabled,'reminders_enabled',s.reminders_enabled)
      from public.finance_settings s where s.singleton),pg_catalog.jsonb_build_object('version',0)),
    'locations',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('location_id',l.id,'code',l.code,'name',l.name,
      'version',coalesce(s.version,0),'branch_name',s.branch_name,'address',s.address,'phone',s.phone,'contact_email',s.contact_email,'document_footer',s.document_footer) order by l.code)
      from public.locations l left join public.finance_location_settings s on s.location_id=l.id where l.active));
end;
$$;
create or replace function public.update_finance_settings(p_request_id uuid,p_expected_version integer,p_location_id uuid,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); allowed text[]; key text; normalized jsonb:='{}'; value jsonb;
  payload jsonb; replay jsonb; result jsonb; old_version integer; next_version integer;
begin
  if not private.app_is_admin() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_expected_version is null or p_expected_version<0 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_location_id is not null and not exists(select 1 from public.locations l where l.id=p_location_id and l.active) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  allowed:=case when p_location_id is null then array['business_name','abn','address','phone','shared_email','logo_asset_path','logo_sha256','bank_instructions','invoice_footer'] else array['branch_name','address','phone','contact_email','document_footer'] end;
  perform private.finance_json_keys(p_settings,allowed);
  foreach key in array allowed loop
    value:=p_settings->key;
    if value is null or value='null'::jsonb then normalized:=normalized||pg_catalog.jsonb_build_object(key,null); continue; end if;
    if key in ('address','bank_instructions') then
      perform private.finance_json_keys(value,case when key='address' then array['street_address','suburb','state','postcode','country'] else array['bank_name','account_name','bsb','account_number','payment_reference','instructions'] end);
      if exists(select 1 from pg_catalog.jsonb_each(value) e where pg_catalog.jsonb_typeof(e.value) not in ('string','null') or length(e.value::text)>2000) then
        raise exception 'INVALID_FINANCE_INPUT' using errcode='22023';
      end if;
    else
      if pg_catalog.jsonb_typeof(value)<>'string' or length(value #>> '{}')>2000 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
      value:=pg_catalog.to_jsonb(nullif(btrim(value #>> '{}'),''));
    end if;
    normalized:=normalized||pg_catalog.jsonb_build_object(key,value);
  end loop;
  if normalized->>'abn' is not null and normalized->>'abn' !~ '^[0-9]{11}$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if normalized->>'logo_sha256' is not null and normalized->>'logo_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if normalized->>'logo_asset_path' ~ '(^/|(^|/)\.\.(/|$)|://)' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if coalesce(normalized->>'shared_email',normalized->>'contact_email') is not null
    and coalesce(normalized->>'shared_email',normalized->>'contact_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_FINANCE_INPUT' using errcode='22023';
  end if;
  payload:=pg_catalog.jsonb_build_object('version',p_expected_version,'location',p_location_id,'settings',normalized);
  replay:=private.finance_request(p_request_id,'update_finance_settings',payload);
  if replay is not null then return replay; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-settings:'||coalesce(p_location_id::text,'global'),0));
  if p_location_id is null then select s.version into old_version from public.finance_settings s where s.singleton for update;
  else select s.version into old_version from public.finance_location_settings s where s.location_id=p_location_id for update; end if;
  if coalesce(old_version,0)<>p_expected_version then raise exception 'FINANCE_VERSION_CONFLICT' using errcode='40001'; end if;
  next_version:=coalesce(old_version,0)+1;
  if p_location_id is null then
    insert into public.finance_settings(singleton,business_name,abn,address,phone,shared_email,logo_asset_path,logo_sha256,bank_instructions,invoice_footer,updated_by,version)
    values(true,normalized->>'business_name',normalized->>'abn',nullif(normalized->'address','null'::jsonb),normalized->>'phone',normalized->>'shared_email',normalized->>'logo_asset_path',normalized->>'logo_sha256',nullif(normalized->'bank_instructions','null'::jsonb),normalized->>'invoice_footer',actor,next_version)
    on conflict (singleton) do update set business_name=excluded.business_name,abn=excluded.abn,address=excluded.address,phone=excluded.phone,shared_email=excluded.shared_email,logo_asset_path=excluded.logo_asset_path,logo_sha256=excluded.logo_sha256,bank_instructions=excluded.bank_instructions,invoice_footer=excluded.invoice_footer,updated_by=actor,version=next_version,updated_at=now();
  else
    insert into public.finance_location_settings(location_id,branch_name,address,phone,contact_email,document_footer,updated_by,version)
    values(p_location_id,normalized->>'branch_name',nullif(normalized->'address','null'::jsonb),normalized->>'phone',normalized->>'contact_email',normalized->>'document_footer',actor,next_version)
    on conflict (location_id) do update set branch_name=excluded.branch_name,address=excluded.address,phone=excluded.phone,contact_email=excluded.contact_email,document_footer=excluded.document_footer,updated_by=actor,version=next_version,updated_at=now();
  end if;
  result:=pg_catalog.jsonb_build_object('version',next_version);
  perform private.sales_audit('FINANCE_SETTINGS_UPDATED','finance_settings',p_location_id,p_location_id,pg_catalog.jsonb_build_object('request_id',p_request_id,'version',next_version,'changed_fields',allowed));
  perform private.finance_request_finish(p_request_id,'update_finance_settings',payload,p_location_id,p_location_id,result);
  return result;
end;
$$;
create or replace function public.invoice_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; revisions jsonb;
begin
  perform private.finance_guard('invoices.view');
  select * into i from public.invoices x where x.id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'revision_number',r.revision_number,'lifecycle',r.lifecycle,
    'issue_date',r.issue_date,'due_date',r.due_date,'payment_terms',r.payment_terms,'total_incl_gst',r.total_incl_gst,
    'subtotal_ex_gst',r.subtotal_ex_gst,'gst_amount',r.gst_amount,'pricing_complete',r.pricing_complete,
    'lines',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',l.id,'position',l.position,'description',l.description,
      'quantity',l.quantity,'unit_price_incl_gst',l.unit_price_incl_gst,'discount_percent',l.discount_percent,
      'total_incl_gst',l.total_incl_gst,'gst_amount',l.gst_amount,'subtotal_ex_gst',l.subtotal_ex_gst) order by l.position),'[]'::jsonb)
      from public.invoice_lines l where l.revision_id=r.id)) order by r.revision_number) into revisions
    from public.invoice_revisions r where r.invoice_id=i.id;
  return pg_catalog.jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'location_id',i.location_id,
    'customer_id',i.customer_id,'job_id',i.job_id,'status',i.status,'version',i.version,'current_revision_id',i.current_revision_id,
    'first_payment_at',i.first_payment_at,'revisions',coalesce(revisions,'[]'::jsonb));
end;
$$;
create or replace function public.invoice_cost_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare location uuid;
begin
  perform private.finance_guard('invoices.view');
  select i.location_id into location from public.invoices i where i.id=p_invoice_id;
  if location is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',location);
  perform private.finance_guard('inventory.view_cost',location);
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('invoice_line_id',c.invoice_line_id,
    'captured_unit_cost',c.captured_unit_cost,'captured_quantity',c.captured_quantity,'capture_source',c.capture_source) order by l.revision_id,l.position),'[]'::jsonb)
    from public.invoice_line_costs c join public.invoice_lines l on l.id=c.invoice_line_id where l.invoice_id=p_invoice_id);
end;
$$;
revoke execute on function public.finance_settings_detail(),public.update_finance_settings(uuid,integer,uuid,jsonb),public.invoice_detail(uuid),public.invoice_cost_detail(uuid)
  from public,anon,service_role;
grant execute on function public.finance_settings_detail(),public.update_finance_settings(uuid,integer,uuid,jsonb),public.invoice_detail(uuid),public.invoice_cost_detail(uuid) to authenticated;
