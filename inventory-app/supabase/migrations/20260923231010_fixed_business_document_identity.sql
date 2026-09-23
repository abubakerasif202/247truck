-- Freeze new-document issuer identity. Historical invoice revisions and their
-- business/branch snapshots are deliberately left untouched.
revoke execute on function public.update_finance_settings(uuid,integer,uuid,jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.update_invoice_brand_settings(text,integer,jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.finance_settings_detail() from public, anon, authenticated, service_role;
drop trigger if exists finance_settings_sync_247_brand on public.finance_settings;

-- Legacy settings tables remain for migration and audit compatibility. This
-- function is the database issuance boundary; UI values mirror it in
-- lib/business-config.ts. It contains public identity only, never credentials.
create or replace function private.document_business_config(p_brand text)
returns jsonb language plpgsql immutable security definer set search_path = '' as $$
begin
  case p_brand
    when '247' then return pg_catalog.jsonb_build_object(
      'schema_version', 2, 'brand', '247', 'business_name', '24/7 Truck Tyre Services',
      'legal_name', 'AGGY TEK PTY LTD', 'abn', '85640190996',
      'address', pg_catalog.jsonb_build_object('street_address','1/55 Plymouth Road','suburb','Wingfield','state','SA','postcode','5013','country','Australia'),
      'phone', '+61 452 636 802', 'shared_email', 'admin@247trucktyreservices.com.au',
      'website', 'https://247trucktyreservices.com.au', 'logo_asset_path', '/brand/logo-real-horizontal.png',
      'logo_sha256', null, 'primary_colour', '#c91f2c', 'accent_colour', '#8f1721',
      'bank_instructions', pg_catalog.jsonb_build_object('bank_name','ANZ','account_name','24/7 Truck Tyre Service','bsb','065122','account_number','11293981','payment_reference','Invoice number','instructions','Please quote the invoice number as the payment reference.'),
      'invoice_footer', 'Please note wheels require re-tensioning within 50 km of fitting. All parts and tyres remain the property of 24/7 Truck Tyre Services until the invoice is paid in full.',
      'email_sender_name', '24/7 Truck Tyre Services', 'reply_to_address', 'admin@247trucktyreservices.com.au',
      'timezone', 'Australia/Adelaide', 'currency', 'AUD');
    when 'awt' then return pg_catalog.jsonb_build_object(
      'schema_version', 2, 'brand', 'awt', 'business_name', 'Adelaide Wholesale Tyres',
      'abn', '47690275588',
      'address', pg_catalog.jsonb_build_object('street_address','4 Birralee Rd','suburb','Regency Park','state','SA','postcode','5010','country','Australia'),
      'phone', '+61 478 827 017', 'shared_email', 'admin@adelaidewholesaletyres.com.au',
      'website', 'https://adelaidewholesaletyres.com.au', 'logo_asset_path', '/invoice-templates/awt-logo.png',
      'logo_sha256', null, 'primary_colour', '#ef1d27', 'accent_colour', '#17191c',
      'bank_instructions', pg_catalog.jsonb_build_object('bank_name','ANZ','account_name','Adelaide Wholesale Tyres','bsb','065122','account_number','11293981','payment_reference','Invoice number','instructions','Please quote the invoice number as the payment reference.'),
      'invoice_footer', 'Thank you for choosing Adelaide Wholesale Tyres. Please quote the invoice number with payment.',
      'email_sender_name', 'Adelaide Wholesale Tyres', 'reply_to_address', 'admin@adelaidewholesaletyres.com.au',
      'timezone', 'Australia/Adelaide', 'currency', 'AUD');
    else raise exception 'INVALID_INVOICE_BRAND' using errcode='22023';
  end case;
end;
$$;
revoke all on function private.document_business_config(text) from public, anon, authenticated, service_role;

-- Keep the existing location/organization authorization rules while removing
-- the legacy table from active brand guards and option readers.
create or replace function private.invoice_brand_guard(p_brand text, p_location_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare authorized text[] := private.location_authorized_brands(p_location_id); chosen text;
begin
  if array_length(authorized,1) is null then
    chosen := coalesce(nullif(p_brand,''),private.invoice_brand_for_location(p_location_id));
    if not private.app_is_admin() and chosen is distinct from private.invoice_brand_for_location(p_location_id) then
      raise exception 'ACCESS_DENIED' using errcode='42501';
    end if;
  else
    chosen := coalesce(nullif(p_brand,''),case when array_length(authorized,1)=1 then authorized[1] end);
    if chosen is null or not (chosen = any(authorized)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  end if;
  if chosen is null or chosen not in ('247','awt') then raise exception 'INVALID_INVOICE_BRAND' using errcode='22023'; end if;
  return chosen;
end;
$$;
revoke all on function private.invoice_brand_guard(text,uuid) from public, anon, authenticated, service_role;

create or replace function private.transaction_brand_guard(p_brand text, p_location_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare authorized text[] := private.location_authorized_brands(p_location_id); chosen text;
begin
  if array_length(authorized,1) is null then raise exception 'BUSINESS_NOT_CONFIGURED' using errcode='22023'; end if;
  chosen := coalesce(nullif(p_brand,''),case when array_length(authorized,1)=1 then authorized[1] end);
  if chosen is null then raise exception 'BUSINESS_SELECTION_REQUIRED' using errcode='22023'; end if;
  if not (chosen = any(authorized)) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if chosen not in ('247','awt') then raise exception 'INVALID_INVOICE_BRAND' using errcode='22023'; end if;
  return chosen;
end;
$$;
revoke all on function private.transaction_brand_guard(text,uuid) from public, anon, authenticated, service_role;

create or replace function public.invoice_brand_options(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare authorized text[] := private.location_authorized_brands(p_location_id);
  default_brand text; can_override boolean; visible text[];
begin
  perform private.finance_guard('invoices.view',p_location_id);
  if array_length(authorized,1) is null then
    default_brand := private.invoice_brand_for_location(p_location_id);
    can_override := private.app_is_admin();
    visible := case when can_override then array['247','awt'] else array[default_brand] end;
  else
    default_brand := case when array_length(authorized,1)=1 then authorized[1] end;
    can_override := array_length(authorized,1)>1;
    visible := authorized;
  end if;
  return pg_catalog.jsonb_build_object('default_brand',default_brand,'can_override',can_override,
    'brands',(select coalesce(pg_catalog.jsonb_agg(private.document_business_config(b.brand)||pg_catalog.jsonb_build_object('email',private.document_business_config(b.brand)->>'shared_email') order by b.brand),'[]'::jsonb)
      from pg_catalog.unnest(visible) b(brand) where b.brand in ('247','awt')));
end;
$$;
revoke execute on function public.invoice_brand_options(uuid) from public, anon, service_role;
grant execute on function public.invoice_brand_options(uuid) to authenticated;

create or replace function public.pos_business_options(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare authorized text[] := private.location_authorized_brands(p_location_id);
begin
  perform private.finance_guard('invoices.view',p_location_id);
  return pg_catalog.jsonb_build_object(
    'default_brand',case when array_length(authorized,1)=1 then authorized[1] end,
    'can_override',coalesce(array_length(authorized,1),0)>1,
    'businesses',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('brand',b.brand,'business_name',private.document_business_config(b.brand)->>'business_name') order by b.brand),'[]'::jsonb)
      from pg_catalog.unnest(authorized) b(brand) where b.brand in ('247','awt')));
end;
$$;
revoke execute on function public.pos_business_options(uuid) from public, anon, service_role;
grant execute on function public.pos_business_options(uuid) to authenticated;

-- Preview and compatibility reads use fixed values; the table is retained as
-- read-only legacy configuration because earlier migrations reference it.
update public.invoice_brand_settings as s set
  business_name = c.v->>'business_name', abn = c.v->>'abn', address = c.v->'address',
  phone = c.v->>'phone', email = c.v->>'shared_email', website = c.v->>'website',
  logo_asset_path = c.v->>'logo_asset_path', logo_sha256 = null,
  primary_colour = c.v->>'primary_colour', accent_colour = c.v->>'accent_colour',
  bank_instructions = c.v->'bank_instructions', invoice_footer = c.v->>'invoice_footer',
  email_sender_name = c.v->>'email_sender_name', reply_to_address = c.v->>'reply_to_address',
  updated_at = now(), version = version + 1
from (select brand, private.document_business_config(brand) as v from (values ('247'),('awt')) b(brand)) c
where s.brand = c.brand;

create or replace function private.finance_issue_snapshots(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; business jsonb;
  c public.customers%rowtype; v public.customer_vehicles%rowtype; bc public.customer_contacts%rowtype;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode='P0002'; end if;
  business := private.document_business_config(i.brand);
  if i.customer_id is not null then
    select * into c from public.customers where id=i.customer_id;
    if i.customer_vehicle_id is not null then select * into v from public.customer_vehicles where id=i.customer_vehicle_id; end if;
    select * into bc from public.customer_contacts where customer_id=i.customer_id and active and billing_contact order by primary_contact desc,created_at,id limit 1;
  end if;
  return pg_catalog.jsonb_build_object(
    'business', business,
    'branch', pg_catalog.jsonb_build_object('location_id',i.location_id),
    'customer', case when i.customer_id is null then pg_catalog.jsonb_build_object('label','Walk-In Customer') else pg_catalog.jsonb_build_object('customer_id',c.id,'customer_type',c.customer_type,'display_name',c.display_name,'legal_name',c.legal_name,'company_name',c.company_name,'abn',c.abn,'payment_terms',c.payment_terms,'street_address',c.street_address,'suburb',c.suburb,'state',c.state,'postcode',c.postcode) end,
    'billing_contact',case when bc.id is null then null else pg_catalog.jsonb_build_object('contact_id',bc.id,'first_name',bc.first_name,'last_name',bc.last_name,'email',bc.email,'phone',coalesce(bc.mobile,bc.phone)) end,
    'vehicle',case when v.id is null then null else pg_catalog.jsonb_build_object('vehicle_id',v.id,'registration',v.registration,'fleet_number',v.fleet_number,'vehicle_type',v.vehicle_type) end,
    'recipient_email',coalesce(i.delivery_email_override,bc.email,c.billing_email,c.accounts_email,c.email));
end;
$$;
revoke all on function private.finance_issue_snapshots(uuid) from public, anon, authenticated, service_role;

-- Quotes currently use the 24/7 issuer and have no brand column. Resolve the
-- identity through the same fixed configuration used at invoice issuance.
create or replace function public.quote_detail(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q public.quotes%rowtype; lines jsonb; location_row public.locations%rowtype;
begin
  if not private.sales_permission('quotes.view') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and private.sales_location_allowed(location_id);
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  select * into location_row from public.locations where id=q.location_id;
  select coalesce(pg_catalog.jsonb_agg(to_jsonb(l) || pg_catalog.jsonb_build_object('product_snapshot',case when p.id is null then null else pg_catalog.jsonb_build_object('brand_name',b.display_name,'pattern_name',pat.display_name,'size_name',s.display_size) end) order by l.line_position),'[]'::jsonb)
    into lines from public.quote_lines l left join public.products p on p.id=l.product_id
    left join public.tyre_brands b on b.id=p.tyre_brand_id left join public.tyre_patterns pat on pat.id=p.tyre_pattern_id
    left join public.tyre_sizes s on s.id=p.tyre_size_id where l.quote_id=q.id;
  return to_jsonb(q)-'created_by'||pg_catalog.jsonb_build_object('lines',lines,'cost_basis',null,'weighted_average_cost',null,
    'location_name',location_row.name,'business_snapshot',private.document_business_config('247'),
    'branch_snapshot',pg_catalog.jsonb_build_object('location_id',q.location_id));
end;
$$;
revoke execute on function public.quote_detail(uuid) from public, anon, service_role;
grant execute on function public.quote_detail(uuid) to authenticated;

comment on table public.invoice_brand_settings is 'Legacy read-only preview cache; new invoice issuer snapshots use private.document_business_config.';
comment on table public.finance_settings is 'Legacy finance configuration retained for migration and audit compatibility; no operational editing.';
comment on table public.finance_location_settings is 'Legacy branch document configuration retained for migration and audit compatibility; no operational editing.';
