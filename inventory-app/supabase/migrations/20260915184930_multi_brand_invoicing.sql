-- Central issuer configuration and immutable invoice-brand ownership.
-- Existing REG/LON invoices are backfilled only where the workspace relationship
-- is deterministic. Unknown locations remain NULL and retain legacy snapshot
-- rendering instead of receiving a guessed issuer.
create table public.invoice_brand_settings (
  brand text primary key check (brand in ('247','awt')),
  business_name text not null,
  abn text,
  address jsonb,
  phone text,
  email text,
  website text,
  logo_asset_path text,
  logo_sha256 text,
  primary_colour text check (primary_colour is null or primary_colour ~ '^#[0-9A-Fa-f]{6}$'),
  accent_colour text check (accent_colour is null or accent_colour ~ '^#[0-9A-Fa-f]{6}$'),
  bank_instructions jsonb,
  invoice_footer text,
  email_sender_name text,
  reply_to_address text,
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

alter table public.invoice_brand_settings enable row level security;
revoke all on public.invoice_brand_settings from public, anon, authenticated, service_role;

insert into public.invoice_brand_settings (brand,business_name,email_sender_name,primary_colour,accent_colour)
values ('247','24/7 Truck Tyre Services','24/7 Truck Tyre Services','#c91f2c','#8f1721')
on conflict (brand) do nothing;

insert into public.invoice_brand_settings (
  brand,business_name,abn,address,phone,email,logo_asset_path,logo_sha256,
  primary_colour,accent_colour,bank_instructions,invoice_footer,email_sender_name,reply_to_address
)
select '247',coalesce(business_name,'24/7 Truck Tyre Services'),abn,address,phone,shared_email,
  logo_asset_path,logo_sha256,'#c91f2c','#8f1721',bank_instructions,invoice_footer,
  coalesce(business_name,'24/7 Truck Tyre Services'),shared_email
from public.finance_settings where singleton
on conflict (brand) do update set business_name=excluded.business_name,abn=excluded.abn,address=excluded.address,phone=excluded.phone,
  email=excluded.email,logo_asset_path=excluded.logo_asset_path,logo_sha256=excluded.logo_sha256,bank_instructions=excluded.bank_instructions,
  invoice_footer=excluded.invoice_footer,email_sender_name=excluded.email_sender_name,reply_to_address=excluded.reply_to_address;

insert into public.invoice_brand_settings (brand,business_name,email_sender_name,primary_colour,accent_colour)
values ('awt','AWT Tyres','AWT Tyres','#1f4b7a','#173653')
on conflict (brand) do nothing;

create or replace function private.sync_247_invoice_brand_settings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.invoice_brand_settings set business_name=coalesce(new.business_name,business_name),abn=new.abn,address=new.address,
    phone=new.phone,email=new.shared_email,logo_asset_path=new.logo_asset_path,logo_sha256=new.logo_sha256,
    bank_instructions=new.bank_instructions,invoice_footer=new.invoice_footer,
    email_sender_name=coalesce(new.business_name,email_sender_name),reply_to_address=new.shared_email,
    updated_by=new.updated_by,updated_at=now(),version=version+1 where brand='247';
  return new;
end;
$$;
create trigger finance_settings_sync_247_brand after insert or update on public.finance_settings
for each row execute function private.sync_247_invoice_brand_settings();

create or replace function public.update_invoice_brand_settings(p_brand text,p_expected_version integer,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current public.invoice_brand_settings%rowtype; actor uuid;
begin
  if not private.app_is_admin() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=auth.uid();
  if p_brand not in ('247','awt') or jsonb_typeof(p_settings)<>'object' then raise exception 'INVALID_INVOICE_BRAND' using errcode='22023'; end if;
  perform private.finance_json_keys(p_settings,array['business_name','abn','address','phone','email','website','logo_asset_path','logo_sha256','primary_colour','accent_colour','bank_instructions','invoice_footer','email_sender_name','reply_to_address']);
  select * into current from public.invoice_brand_settings where brand=p_brand for update;
  if current.version<>p_expected_version then raise exception 'FINANCE_VERSION_CONFLICT' using errcode='PT409'; end if;
  update public.invoice_brand_settings set
    business_name=coalesce(nullif(btrim(p_settings->>'business_name'),''),business_name),abn=nullif(btrim(p_settings->>'abn'),''),address=p_settings->'address',
    phone=nullif(btrim(p_settings->>'phone'),''),email=nullif(btrim(p_settings->>'email'),''),website=nullif(btrim(p_settings->>'website'),''),
    logo_asset_path=nullif(btrim(p_settings->>'logo_asset_path'),''),logo_sha256=nullif(btrim(p_settings->>'logo_sha256'),''),
    primary_colour=nullif(btrim(p_settings->>'primary_colour'),''),accent_colour=nullif(btrim(p_settings->>'accent_colour'),''),
    bank_instructions=p_settings->'bank_instructions',invoice_footer=nullif(btrim(p_settings->>'invoice_footer'),''),
    email_sender_name=nullif(btrim(p_settings->>'email_sender_name'),''),reply_to_address=nullif(btrim(p_settings->>'reply_to_address'),''),
    updated_by=actor,updated_at=now(),version=version+1 where brand=p_brand;
  perform private.sales_audit('INVOICE_BRAND_SETTINGS_UPDATED','invoice_brand',null,null,jsonb_build_object('brand',p_brand,'version_after',current.version+1));
  return jsonb_build_object('brand',p_brand,'version',current.version+1);
end;
$$;

alter table public.invoices add column brand text check (brand in ('247','awt'));

update public.invoices i set brand=case l.code when 'LON' then 'awt' when 'REG' then '247' end
from public.locations l where l.id=i.location_id and l.code in ('LON','REG') and i.brand is null;

create or replace function private.invoice_brand_for_location(p_location_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case l.code when 'LON' then 'awt' when 'REG' then '247' end
  from public.locations l where l.id=p_location_id and l.active
$$;

create or replace function private.invoice_brand_guard(p_brand text,p_location_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare chosen text:=coalesce(nullif(p_brand,''),private.invoice_brand_for_location(p_location_id));
begin
  if chosen not in ('247','awt') then raise exception 'INVALID_INVOICE_BRAND' using errcode='22023'; end if;
  -- Managers are workspace-pinned. Admins with access to the target location may override.
  if not private.app_is_admin() and chosen is distinct from private.invoice_brand_for_location(p_location_id) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  if not exists(select 1 from public.invoice_brand_settings s where s.brand=chosen) then
    raise exception 'INVOICE_BRAND_NOT_CONFIGURED' using errcode='22023';
  end if;
  return chosen;
end;
$$;

create or replace function private.invoice_brand_default_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Legacy RPC callers predate workspace-aware branding and retain the former
  -- 24/7 issuer. New application paths call the *_with_brand RPCs below and
  -- atomically replace this compatibility default before returning the draft.
  new.brand:=coalesce(new.brand,'247');
  if new.brand is null then raise exception 'INVALID_INVOICE_BRAND' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger invoices_brand_default before insert on public.invoices
for each row execute function private.invoice_brand_default_trigger();

create or replace function public.invoice_brand_options(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare default_brand text;
begin
  perform private.finance_guard('invoices.view',p_location_id);
  default_brand:=private.invoice_brand_for_location(p_location_id);
  return jsonb_build_object(
    'default_brand',default_brand,
    'can_override',private.app_is_admin(),
    'brands',(select coalesce(jsonb_agg(jsonb_build_object(
      'brand',s.brand,'business_name',s.business_name,'abn',s.abn,'address',s.address,'phone',s.phone,
      'email',s.email,'website',s.website,'logo_asset_path',s.logo_asset_path,
      'primary_colour',s.primary_colour,'accent_colour',s.accent_colour,
      'bank_instructions',s.bank_instructions,'invoice_footer',s.invoice_footer,
      'email_sender_name',s.email_sender_name,'reply_to_address',s.reply_to_address,'version',s.version
    ) order by s.brand),'[]'::jsonb) from public.invoice_brand_settings s where private.app_is_admin() or s.brand=default_brand)
  );
end;
$$;

create or replace function public.create_manual_invoice_with_brand(p_request_id uuid,p_location_id uuid,p_brand text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare chosen text; result jsonb; current_brand text;
begin
  chosen:=private.invoice_brand_guard(p_brand,p_location_id);
  result:=public.create_manual_invoice_v2(p_request_id,p_location_id,p_input);
  select brand into current_brand from public.invoices where id=(result->>'invoice_id')::uuid for update;
  if current_brand is distinct from chosen and (result->>'status')<>'draft' then raise exception 'INVOICE_BRAND_LOCKED' using errcode='42501'; end if;
  update public.invoices set brand=chosen where id=(result->>'invoice_id')::uuid and status='draft';
  return result||jsonb_build_object('brand',chosen);
end;
$$;

create or replace function public.create_invoice_from_job_with_brand(p_request_id uuid,p_job_id uuid,p_brand text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare location uuid; chosen text; result jsonb; current_brand text;
begin
  select location_id into location from public.jobs where id=p_job_id;
  if location is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  chosen:=private.invoice_brand_guard(p_brand,location);
  result:=public.create_invoice_from_job(p_request_id,p_job_id);
  select brand into current_brand from public.invoices where id=(result->>'invoice_id')::uuid for update;
  if current_brand is distinct from chosen and (result->>'status')<>'draft' then raise exception 'INVOICE_BRAND_LOCKED' using errcode='42501'; end if;
  update public.invoices set brand=chosen where id=(result->>'invoice_id')::uuid and status='draft';
  return result||jsonb_build_object('brand',chosen);
end;
$$;

create or replace function public.complete_job_and_create_invoice_with_brand(p_request_id uuid,p_job_id uuid,p_expected_version integer,p_brand text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare location uuid; chosen text; result jsonb;
begin
  select location_id into location from public.jobs where id=p_job_id;
  if location is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  chosen:=private.invoice_brand_guard(p_brand,location);
  result:=public.complete_job_and_create_invoice(p_request_id,p_job_id,p_expected_version);
  update public.invoices set brand=chosen where id=(result->>'invoice_id')::uuid and status='draft';
  return result||jsonb_build_object('brand',chosen);
end;
$$;

create or replace function public.update_invoice_draft_with_brand(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_brand text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype; chosen text; result jsonb;
begin
  select * into inv from public.invoices where id=p_invoice_id;
  if inv.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  chosen:=private.invoice_brand_guard(p_brand,inv.location_id);
  result:=public.update_invoice_draft_v2(p_request_id,p_invoice_id,p_expected_version,p_input);
  update public.invoices set brand=chosen where id=p_invoice_id and status='draft';
  return result||jsonb_build_object('brand',chosen);
end;
$$;

-- Issue-time identity now resolves exactly one issuer configuration. The
-- resulting revision snapshots remain authoritative for PDF/email/resends.
create or replace function private.finance_issue_snapshots(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; s public.invoice_brand_settings%rowtype; ls public.finance_location_settings%rowtype;
  c public.customers%rowtype; v public.customer_vehicles%rowtype; bc public.customer_contacts%rowtype;
begin
  select * into i from public.invoices where id=p_invoice_id;
  select * into s from public.invoice_brand_settings where brand=i.brand;
  if s.brand is null or s.business_name is null or coalesce(s.abn,'') !~ '^[0-9]{11}$' or s.address is null or s.phone is null or s.email is null then
    raise exception 'FINANCE_IDENTITY_INCOMPLETE' using errcode='22023';
  end if;
  select * into ls from public.finance_location_settings where location_id=i.location_id;
  if ls.location_id is null or ls.branch_name is null or ls.address is null or ls.phone is null or ls.contact_email is null then
    raise exception 'FINANCE_IDENTITY_INCOMPLETE' using errcode='22023';
  end if;
  if i.customer_id is not null then
    select * into c from public.customers where id=i.customer_id;
    if i.customer_vehicle_id is not null then select * into v from public.customer_vehicles where id=i.customer_vehicle_id; end if;
    select * into bc from public.customer_contacts where customer_id=i.customer_id and active and billing_contact order by primary_contact desc,created_at,id limit 1;
  end if;
  return jsonb_build_object(
    'business',jsonb_build_object('schema_version',2,'brand',s.brand,'business_name',s.business_name,'abn',s.abn,'address',s.address,
      'phone',s.phone,'shared_email',s.email,'website',s.website,'logo_asset_path',s.logo_asset_path,'logo_sha256',s.logo_sha256,
      'primary_colour',s.primary_colour,'accent_colour',s.accent_colour,'bank_instructions',s.bank_instructions,
      'invoice_footer',s.invoice_footer,'email_sender_name',s.email_sender_name,'reply_to_address',s.reply_to_address,
      'timezone','Australia/Adelaide','currency','AUD'),
    'branch',jsonb_build_object('location_id',i.location_id,'branch_name',ls.branch_name,'address',ls.address,'phone',ls.phone,'contact_email',ls.contact_email,'document_footer',ls.document_footer),
    'customer',case when i.customer_id is null then jsonb_build_object('label','Walk-In Customer') else jsonb_build_object('customer_id',c.id,'customer_type',c.customer_type,'display_name',c.display_name,'legal_name',c.legal_name,'company_name',c.company_name,'abn',c.abn,'payment_terms',c.payment_terms,'street_address',c.street_address,'suburb',c.suburb,'state',c.state,'postcode',c.postcode) end,
    'billing_contact',case when bc.id is null then null else jsonb_build_object('contact_id',bc.id,'first_name',bc.first_name,'last_name',bc.last_name,'email',bc.email,'phone',coalesce(bc.mobile,bc.phone)) end,
    'vehicle',case when v.id is null then null else jsonb_build_object('vehicle_id',v.id,'registration',v.registration,'fleet_number',v.fleet_number,'vehicle_type',v.vehicle_type) end,
    'recipient_email',coalesce(i.delivery_email_override,bc.email,c.billing_email,c.accounts_email,c.email));
end;
$$;

revoke execute on function private.sync_247_invoice_brand_settings(),private.invoice_brand_for_location(uuid),private.invoice_brand_guard(text,uuid),private.invoice_brand_default_trigger(),private.finance_issue_snapshots(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.update_invoice_brand_settings(text,integer,jsonb),public.invoice_brand_options(uuid),public.create_manual_invoice_with_brand(uuid,uuid,text,jsonb),public.create_invoice_from_job_with_brand(uuid,uuid,text),public.complete_job_and_create_invoice_with_brand(uuid,uuid,integer,text),public.update_invoice_draft_with_brand(uuid,uuid,integer,text,jsonb) from public,anon,service_role;
grant execute on function public.update_invoice_brand_settings(text,integer,jsonb),public.invoice_brand_options(uuid),public.create_manual_invoice_with_brand(uuid,uuid,text,jsonb),public.create_invoice_from_job_with_brand(uuid,uuid,text),public.complete_job_and_create_invoice_with_brand(uuid,uuid,integer,text),public.update_invoice_draft_with_brand(uuid,uuid,integer,text,jsonb) to authenticated;

comment on column public.invoices.brand is 'Persisted invoice issuer. Issued revision snapshots are the rendering authority; NULL is retained only for unresolved legacy rows.';
