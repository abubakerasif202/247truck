-- Staff-confirmed transaction prices remain distinct from nullable catalogue prices.
-- Existing issued invoice revisions and stock history are untouched.
-- A NULL line price remains pending and cannot pass job completion or invoice issue.

-- A direct product-line price is for confirming a pending catalogue price.
-- Changing an existing configured price must use the separate invoice discount
-- authority path, which requires a reason and enforces the manager cap.
create or replace function private.assert_confirmed_product_price(
  p_product_id uuid, p_tier text, p_price numeric, p_explicit boolean
)
returns void language plpgsql stable security definer set search_path = '' as $$
declare configured numeric;
begin
  if not p_explicit then return; end if;
  configured := private.product_sale_price(p_product_id,p_tier);
  if configured is not null and p_price is distinct from configured then
    raise exception 'PRICE_OVERRIDE_NOT_AUTHORIZED' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function private.assert_confirmed_product_price(uuid,text,numeric,boolean)
  from public, anon, authenticated, service_role;

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
      if row ? 'unit_price_incl_gst' then
        if pg_catalog.jsonb_typeof(row->'unit_price_incl_gst') not in ('number','null') then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
        price:=(row->>'unit_price_incl_gst')::numeric;
        if price < 0 or price > 99999999.99 or price <> pg_catalog.round(price,2) then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
      else
        price:=product.retail_price_incl_gst;
      end if; perform private.assert_confirmed_product_price(product.id,'retail',price,row ? 'unit_price_incl_gst'); if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
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
      if row ? 'unit_price_incl_gst' then
        if pg_catalog.jsonb_typeof(row->'unit_price_incl_gst') not in ('number','null') then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
        price:=(row->>'unit_price_incl_gst')::numeric;
        if price < 0 or price > 99999999.99 or price <> pg_catalog.round(price,2) then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
      else
        price:=private.product_sale_price(product.id,tier);
      end if; perform private.assert_confirmed_product_price(product.id,tier,price,row ? 'unit_price_incl_gst'); if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
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
    if row->>'line_type'='product' then select * into product from public.products where id=(row->>'product_id')::uuid; if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if; if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if; if row ? 'unit_price_incl_gst' then
        if pg_catalog.jsonb_typeof(row->'unit_price_incl_gst') not in ('number','null') then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
        price:=(row->>'unit_price_incl_gst')::numeric;
        if price < 0 or price > 99999999.99 or price <> pg_catalog.round(price,2) then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
      else
        price:=private.product_sale_price(product.id,tier);
      end if; perform private.assert_confirmed_product_price(product.id,tier,price,row ? 'unit_price_incl_gst'); if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if; insert into public.job_lines(job_id,line_position,line_type,product_id,used_tyre_unit_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier) values(jid,pos,'product',product.id,nullif(row->>'used_tyre_unit_id','')::uuid,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,tier);
    elsif row->>'line_type'='labour' then price:=(row->>'unit_price_incl_gst')::numeric; if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if; line_total:=round(qty*price,2); total:=total+line_total; insert into public.job_lines(job_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier) values(jid,pos,'labour',btrim(row->>'description'),qty,price,line_total,tier);
    else raise exception 'INVALID_JOB_LINE' using errcode='22023'; end if;
  end loop;
  update public.jobs set subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete where id=jid;
  perform private.reserve_job_lines(jid,p_location_id,actor); result:=jsonb_build_object('job_id',jid,'job_number',number,'status','new','pricing_complete',complete,'pricing_tier',tier,'total_incl_gst',case when complete then total else null end,'version',1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'create_job',actor,jid,payload_hash,result); perform private.sales_audit('JOB_CREATED','job',jid,p_location_id,jsonb_build_object('job_number',number,'source_type',coalesce(nullif(p_job->>'source_type',''),'direct'),'pricing_tier',tier)); return result;
end; $$;

create or replace function public.update_quote_draft(p_quote_id uuid,p_expected_version integer,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb; tier text; old_lines jsonb:='[]'::jsonb;
begin
  if not private.sales_permission('quotes.edit') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and private.sales_location_allowed(location_id) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.version<>p_expected_version then raise exception 'QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if q.status<>'draft' then raise exception 'QUOTE_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  if q.customer_id is not null then
    select * into c from public.customers where id=q.customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    tier:=case
      when q.customer_snapshot ? 'pricing_tier' then case when q.customer_snapshot->>'pricing_tier'='wholesale' then 'wholesale' else 'retail' end
      when c.pricing_tier='wholesale' then 'wholesale'
      else 'retail'
    end;
    if q.customer_vehicle_id is not null then
      select * into v from public.customer_vehicles where id=q.customer_vehicle_id and customer_id=q.customer_id and active;
      if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
    end if;
  else
    tier:='retail';
  end if;
  select coalesce(pg_catalog.jsonb_agg(to_jsonb(l)),'[]'::jsonb) into old_lines from public.quote_lines l where l.quote_id=q.id;
  delete from public.quote_lines where quote_id=q.id;
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      if row ? 'unit_price_incl_gst' then
        if pg_catalog.jsonb_typeof(row->'unit_price_incl_gst') not in ('number','null') then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
        price:=(row->>'unit_price_incl_gst')::numeric;
        if price < 0 or price > 99999999.99 or price <> pg_catalog.round(price,2) then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
      else
        price:=private.product_sale_price(product.id,tier);
      end if;
      if not exists (
        select 1 from pg_catalog.jsonb_array_elements(old_lines) old_line(value)
        where (old_line.value->>'line_position')::integer = pos
          and old_line.value->>'product_id' = product.id::text
          and (old_line.value->>'unit_price_incl_gst')::numeric is not distinct from price
      ) then perform private.assert_confirmed_product_price(product.id,tier,price,row ? 'unit_price_incl_gst'); end if;
      if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.quote_lines(quote_id,line_position,line_type,product_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier)
      values(q.id,pos,'product',product.id,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,tier);
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric;
      if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.quote_lines(quote_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,pricing_tier)
      values(q.id,pos,'labour',btrim(row->>'description'),qty,price,line_total,tier);
    else raise exception 'INVALID_QUOTE_LINE' using errcode='22023'; end if;
  end loop;
  update public.quotes set customer_reference=nullif(btrim(p_quote->>'customer_reference'),''),internal_notes=nullif(btrim(p_quote->>'internal_notes'),''),customer_notes=nullif(btrim(p_quote->>'customer_notes'),''),expiry_date=(p_quote->>'expiry_date')::date,
    customer_snapshot=case when q.customer_id is null then q.customer_snapshot else to_jsonb(c)-'mobile_normalized'-'phone_normalized'-'email_normalized'-'billing_email_normalized'-'accounts_email_normalized'-'abn_normalized' end,
    vehicle_snapshot=case when q.customer_id is null then q.vehicle_snapshot when q.customer_vehicle_id is null then null else to_jsonb(v)-'registration_normalized'-'fleet_number_normalized' end,
    subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete,pricing_tier=tier,version=version+1 where id=q.id;
  perform private.sales_audit('QUOTE_CHANGED','quote',q.id,q.location_id,jsonb_build_object('quote_number',q.quote_number,'version_before',q.version,'version_after',q.version+1,'pricing_tier',tier,'pricing_complete',complete));
  result:=jsonb_build_object('quote_id',q.id,'quote_number',q.quote_number,'status','draft','pricing_complete',complete,'pricing_tier',tier,'subtotal_ex_gst',case when complete then total-round(total/11,2) else null end,'gst_amount',case when complete then round(total/11,2) else null end,'total_incl_gst',case when complete then total else null end,'version',q.version+1);
  return result;
end;
$$;

create or replace function public.update_job(p_job_id uuid,p_expected_version integer,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); j public.jobs%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; tier text; old_lines jsonb:='[]'::jsonb;
begin
  if not private.sales_permission('jobs.edit') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into j from public.jobs where id=p_job_id and private.sales_location_allowed(location_id) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  if j.status in ('completed','cancelled') then raise exception 'JOB_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if j.customer_snapshot ? 'pricing_tier' then
    tier:=case when j.customer_snapshot->>'pricing_tier'='wholesale' then 'wholesale' else 'retail' end;
  elsif j.customer_id is not null and exists(select 1 from public.customers c where c.id=j.customer_id and c.active and c.pricing_tier='wholesale') then
    tier:='wholesale';
  else
    tier:='retail';
  end if;
  select coalesce(pg_catalog.jsonb_agg(to_jsonb(l)),'[]'::jsonb) into old_lines from public.job_lines l where l.job_id=j.id and l.is_active;
  perform private.release_job_reservations(j.id);
  update public.job_lines set is_active=false where job_id=j.id;
  for row in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1; qty:=(row->>'quantity')::numeric;
    if row->>'line_type'='product' then
      select * into product from public.products where id=(row->>'product_id')::uuid;
      if not found or not product.active then raise exception 'PRODUCT_INACTIVE' using errcode='22023'; end if;
      if qty<>trunc(qty) or qty<=0 then raise exception 'INVALID_PRODUCT_QUANTITY' using errcode='22023'; end if;
      if row ? 'unit_price_incl_gst' then
        if pg_catalog.jsonb_typeof(row->'unit_price_incl_gst') not in ('number','null') then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
        price:=(row->>'unit_price_incl_gst')::numeric;
        if price < 0 or price > 99999999.99 or price <> pg_catalog.round(price,2) then raise exception 'INVALID_SALE_PRICE' using errcode='22023'; end if;
      else
        price:=private.product_sale_price(product.id,tier);
      end if;
      if not exists (
        select 1 from pg_catalog.jsonb_array_elements(old_lines) old_line(value)
        where (old_line.value->>'line_position')::integer = pos
          and old_line.value->>'product_id' = product.id::text
          and (old_line.value->>'unit_price_incl_gst')::numeric is not distinct from price
      ) then perform private.assert_confirmed_product_price(product.id,tier,price,row ? 'unit_price_incl_gst'); end if;
      if price is null then complete:=false; line_total:=null; else line_total:=round(qty*price,2); total:=total+line_total; end if;
      insert into public.job_lines(job_id,line_position,line_type,product_id,used_tyre_unit_id,description,quantity,unit_price_incl_gst,line_total_incl_gst,is_active,pricing_tier)
      values(j.id,pos,'product',product.id,nullif(row->>'used_tyre_unit_id','')::uuid,coalesce(nullif(btrim(row->>'description'),''),product.name),qty,price,line_total,true,tier)
      on conflict (job_id,line_position) do update set line_type=excluded.line_type,product_id=excluded.product_id,used_tyre_unit_id=excluded.used_tyre_unit_id,description=excluded.description,quantity=excluded.quantity,unit_price_incl_gst=excluded.unit_price_incl_gst,line_total_incl_gst=excluded.line_total_incl_gst,is_active=true,pricing_tier=excluded.pricing_tier;
    elsif row->>'line_type'='labour' then
      price:=(row->>'unit_price_incl_gst')::numeric;
      if price is null or price<0 or qty<=0 then raise exception 'INVALID_LABOUR_LINE' using errcode='22023'; end if;
      line_total:=round(qty*price,2); total:=total+line_total;
      insert into public.job_lines(job_id,line_position,line_type,description,quantity,unit_price_incl_gst,line_total_incl_gst,is_active,pricing_tier)
      values(j.id,pos,'labour',btrim(row->>'description'),qty,price,line_total,true,tier)
      on conflict (job_id,line_position) do update set line_type=excluded.line_type,product_id=null,used_tyre_unit_id=null,description=excluded.description,quantity=excluded.quantity,unit_price_incl_gst=excluded.unit_price_incl_gst,line_total_incl_gst=excluded.line_total_incl_gst,is_active=true,pricing_tier=excluded.pricing_tier;
    else raise exception 'INVALID_JOB_LINE' using errcode='22023'; end if;
  end loop;
  update public.jobs set technician_notes=coalesce(nullif(btrim(p_job->>'technician_notes'),''),technician_notes),customer_notes=coalesce(nullif(btrim(p_job->>'customer_notes'),''),customer_notes),customer_reference=coalesce(nullif(btrim(p_job->>'customer_reference'),''),customer_reference),subtotal_ex_gst=case when complete then total-round(total/11,2) else 0 end,gst_amount=case when complete then round(total/11,2) else 0 end,total_incl_gst=case when complete then total else null end,pricing_complete=complete,version=version+1 where id=j.id;
  perform private.reserve_job_lines(j.id,j.location_id,actor);
  perform private.sales_audit('JOB_UPDATED','job',j.id,j.location_id,jsonb_build_object('version_before',j.version,'version_after',j.version+1,'pricing_tier',tier));
  return jsonb_build_object('job_id',j.id,'status',j.status,'pricing_complete',complete,'pricing_tier',tier,'version',j.version+1);
end;
$$;
