-- 20260918100000_customer_pricing_tier_atomicity.sql widened search_customers
-- (and app/api/sales/{customers,vehicles}/route.ts already widened their own
-- HTTP-level checks) so a user with invoices.view + invoices.create -- but
-- none of customers.view/quotes.view/jobs.view/pos.use -- can look up
-- customers for the manual invoice form. get_customer was never given the
-- same exception, so /api/sales/vehicles still calls get_customer, which
-- still raises ACCESS_DENIED for that user, which lib/customers/queries.ts
-- turns into an uncaught throw -- an unhandled 500 the moment an invoice-only
-- user selects a customer, even though they can already search for one.
create or replace function public.get_customer(p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.customers%rowtype;
begin
  if not ((select private.customer_permission('customers.view')) or ((select private.app_has_permission('invoices.view')) and (select private.app_has_permission('invoices.create')))) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into c from public.customers where id=p_customer_id;
  if not found then raise exception 'CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  return to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized'||jsonb_build_object(
    'contacts',(select coalesce(jsonb_agg(to_jsonb(x)-'mobile_normalized'-'phone_normalized'-'email_normalized' order by x.primary_contact desc,x.first_name,x.id),'[]'::jsonb) from public.customer_contacts x where x.customer_id=c.id),
    'vehicles',(select coalesce(jsonb_agg(to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' order by v.active desc,v.registration,v.id),'[]'::jsonb) from public.customer_vehicles v where v.customer_id=c.id)
  );
end;
$$;
