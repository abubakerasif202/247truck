-- Use the supplied 24/7 logo for new document snapshots. Existing snapshots
-- retain their original asset path and can still render the historical logo.
create or replace function private.document_business_config(p_brand text)
returns jsonb language plpgsql immutable security definer set search_path = '' as $$
begin
  case p_brand
    when '247' then return pg_catalog.jsonb_build_object(
      'schema_version', 2, 'brand', '247', 'business_name', '24/7 Truck Tyre Services',
      'legal_name', 'AGGY TEK PTY LTD', 'abn', '85640190996',
      'address', pg_catalog.jsonb_build_object('street_address','1/55 Plymouth Road','suburb','Wingfield','state','SA','postcode','5013','country','Australia'),
      'phone', '+61 452 636 802', 'shared_email', 'admin@247trucktyreservices.com.au',
      'website', 'https://247trucktyreservices.com.au', 'logo_asset_path', '/brand/logo-247-invoice-2026.png',
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

-- Quotes do not store an immutable business snapshot. Keep their existing logo
-- when quote_detail resolves the shared issuer configuration on each read.
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
    'location_name',location_row.name,'business_snapshot',private.document_business_config('247') || pg_catalog.jsonb_build_object('logo_asset_path','/brand/logo-real-horizontal.png'),
    'branch_snapshot',pg_catalog.jsonb_build_object('location_id',q.location_id));
end;
$$;
revoke execute on function public.quote_detail(uuid) from public, anon, service_role;
grant execute on function public.quote_detail(uuid) to authenticated;
