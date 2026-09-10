-- Production invoicing extensions. Additive over Phases 4A-4C.
-- Finance RPCs never create inventory movements; catalogue references are descriptive only.

alter table public.finance_settings
  add column invoice_prefix text not null default 'INV',
  add column default_payment_terms text not null default '7_days',
  add column invoice_terms jsonb not null default jsonb_build_array(
    'Please note wheels require retention within 50kms of fitting',
    'All parts and tyres remain the property of 24/7 Truck tyre until this invoice is paid in full.'
  ),
  add constraint finance_settings_invoice_prefix_check check (invoice_prefix ~ '^[A-Z][A-Z0-9-]{0,11}$'),
  add constraint finance_settings_default_terms_check check (default_payment_terms in ('due_on_receipt','7_days','14_days','30_days')),
  add constraint finance_settings_invoice_terms_check check (jsonb_typeof(invoice_terms)='array');

alter table public.invoices drop constraint invoices_invoice_number_check;
alter table public.invoices add constraint invoices_invoice_number_check
  check (invoice_number ~ '^[A-Z0-9]{2,12}-[A-Z][A-Z0-9-]{0,11}-[0-9]{6,}$');

alter table public.invoice_revisions
  add column internal_notes text,
  add column payment_method text,
  add column job_details jsonb not null default '{}',
  add constraint invoice_revisions_payment_method_check check
    (payment_method is null or payment_method in ('bank_transfer','cash','card','eftpos','other')),
  add constraint invoice_revisions_job_details_check check (jsonb_typeof(job_details)='object');

alter table public.invoice_lines
  add column pricing_basis text not null default 'inclusive',
  add column gst_treatment text not null default 'taxable',
  add column unit_price_ex_gst numeric(14,2),
  add column discount_type text not null default 'percent',
  add column discount_value numeric(14,2) not null default 0,
  add column tyre_details jsonb not null default '{}',
  add constraint invoice_lines_pricing_basis_check check (pricing_basis in ('exclusive','inclusive')),
  add constraint invoice_lines_gst_treatment_check check (gst_treatment in ('taxable','gst_free')),
  add constraint invoice_lines_discount_type_check check (discount_type in ('percent','fixed')),
  add constraint invoice_lines_discount_value_check check (discount_value>=0),
  add constraint invoice_lines_tyre_details_check check (jsonb_typeof(tyre_details)='object');

-- Replace the original inclusive-only arithmetic checks with checks that support
-- inclusive, exclusive and GST-free lines. Locate generated names by definition
-- because PostgreSQL numbered the unnamed Phase 4A constraints.
do $$ declare c record; begin
  for c in select conname,pg_get_constraintdef(oid) def from pg_constraint
    where conrelid='public.invoice_lines'::regclass and contype='c'
  loop
    if c.def like '%gst_rate = 0.1000%' or c.def like '%base_incl_gst = round((quantity * unit_price_incl_gst)%' then
      execute format('alter table public.invoice_lines drop constraint %I',c.conname);
    end if;
  end loop;
end $$;
alter table public.invoice_lines add constraint invoice_lines_v2_amounts_check check (
  (unit_price_incl_gst is null and unit_price_ex_gst is null and total_incl_gst is null and gst_amount is null and subtotal_ex_gst is null)
  or (unit_price_incl_gst is not null and total_incl_gst is not null and gst_amount is not null and subtotal_ex_gst is not null
    and total_incl_gst=subtotal_ex_gst+gst_amount and gst_amount>=0 and subtotal_ex_gst>=0)
);
alter table public.invoice_lines add constraint invoice_lines_v2_gst_rate_check check (
  (gst_treatment='taxable' and gst_rate=0.1000) or (gst_treatment='gst_free' and gst_rate=0)
);

-- Manual catalogue lines reference a product for description/defaults only. They deliberately
-- have no source job line, invoice cost row, reservation, or stock movement.
alter table public.invoice_lines drop constraint invoice_lines_check;
alter table public.invoice_lines add constraint invoice_lines_source_check check (
  (line_type='product' and quantity>0
    and (source_job_line_id is null or (product_id is not null and quantity=trunc(quantity))))
  or (line_type='labour' and product_id is null and used_tyre_unit_id is null)
);

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash','eftpos','card','bank_transfer','other'));

alter table public.finance_action_requests drop constraint finance_action_requests_action_check;
alter table public.finance_action_requests add constraint finance_action_requests_action_check check (action in (
  'update_finance_settings','finance_draft','finance_issue','finance_revise',
  'create_invoice_from_job','complete_job_and_create_invoice','create_manual_invoice',
  'update_invoice_draft','revise_unpaid_invoice','issue_invoice','cancel_invoice',
  'record_invoice_payment','reverse_manual_payment','finalise_pos_sale',
  'create_manual_invoice_v2','update_invoice_draft_v2','duplicate_invoice_draft','void_issued_invoice'
));

create index invoices_number_search_idx on public.invoices (lower(invoice_number));
create index invoice_revisions_reference_search_idx on public.invoice_revisions (lower(customer_reference));
create index invoice_revisions_service_date_idx on public.invoice_revisions ((job_details->>'service_date'));

create or replace function private.next_invoice_number(p_location_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare prefix text; n text;
begin
  select coalesce(nullif(fs.invoice_prefix,''),'INV') into prefix
  from public.finance_settings fs where fs.singleton;
  prefix:=coalesce(prefix,'INV');
  n:=private.next_location_document_number(p_location_id,'invoice',prefix);
  return n;
end;
$$;

create or replace function private.finance_validate_job_details(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb:=coalesce(p_value,'{}'::jsonb); odo bigint;
begin
  if jsonb_typeof(v)<>'object' or exists(
    select 1 from jsonb_object_keys(v) k
    where k not in ('registration','vehicle_or_fleet_id','odometer_km','service_date','technician_reference')
  ) then raise exception 'INVALID_JOB_DETAILS' using errcode='22023'; end if;
  if v ? 'odometer_km' then
    begin odo:=(v->>'odometer_km')::bigint; exception when others then raise exception 'INVALID_ODOMETER' using errcode='22023'; end;
    if odo<0 then raise exception 'INVALID_ODOMETER' using errcode='22023'; end if;
  end if;
  if v ? 'service_date' then
    begin perform (v->>'service_date')::date; exception when others then raise exception 'INVALID_SERVICE_DATE' using errcode='22023'; end;
  end if;
  return v;
end;
$$;

create or replace function private.finance_write_v2_lines(p_invoice_id uuid,p_revision_id uuid,p_lines jsonb,p_location_id uuid,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e jsonb; pos integer:=0; qty numeric; price numeric; basis text; treatment text;
  dtype text; dvalue numeric; base numeric; discount numeric; ex numeric; gst numeric; total numeric;
  pid uuid; lt text; tyre jsonb; header_ex numeric:=0; header_gst numeric:=0; header_total numeric:=0;
begin
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1;
    if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in
      ('id','line_type','product_id','description','quantity','unit_price','unit_price_incl_gst','pricing_basis',
       'gst_treatment','discount_type','discount_value','discount_percent','discount_reason','tyre_details')) then
      raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    lt:=coalesce(e->>'line_type',case when e->>'product_id' is null then 'labour' else 'product' end);
    if lt not in ('product','labour') then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    pid:=nullif(e->>'product_id','')::uuid;
    if lt='labour' and pid is not null then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    if pid is not null and not exists(select 1 from public.products p where p.id=pid and p.active) then
      raise exception 'PRODUCT_NOT_FOUND' using errcode='22023'; end if;
    if nullif(btrim(e->>'description'),'') is null then raise exception 'INVOICE_LINE_DESCRIPTION_REQUIRED' using errcode='22023'; end if;
    qty:=private.finance_decimal(e->>'quantity',3,12); if qty<=0 then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    price:=private.finance_decimal(coalesce(e->>'unit_price',e->>'unit_price_incl_gst'),2,14);
    basis:=coalesce(e->>'pricing_basis','exclusive'); treatment:=coalesce(e->>'gst_treatment','taxable');
    dtype:=coalesce(e->>'discount_type',case when e ? 'discount_percent' then 'percent' else 'percent' end);
    dvalue:=private.finance_decimal(coalesce(e->>'discount_value',e->>'discount_percent','0'),2,14);
    if basis not in ('exclusive','inclusive') or treatment not in ('taxable','gst_free') or dtype not in ('percent','fixed')
      or (dtype='percent' and dvalue>100) then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    base:=round(qty*price,2); discount:=case when dtype='percent' then round(base*dvalue/100,2) else dvalue end;
    if discount>base then raise exception 'DISCOUNT_EXCEEDS_LINE' using errcode='22023'; end if;
    if dvalue>0 then
      perform private.finance_discount(case when dtype='percent' then dvalue::text
        else (ceil(discount/nullif(base,0)*10000)/100)::numeric(5,2)::text end,e->>'discount_reason','discounts.apply',p_location_id);
    end if;
    if basis='exclusive' then
      ex:=base-discount; gst:=case when treatment='taxable' then round(ex*0.10,2) else 0 end; total:=ex+gst;
    else
      total:=base-discount; gst:=case when treatment='taxable' then round(total/11,2) else 0 end; ex:=total-gst;
    end if;
    tyre:=coalesce(e->'tyre_details','{}'::jsonb);
    if jsonb_typeof(tyre)<>'object' or exists(select 1 from jsonb_object_keys(tyre) k where k not in
      ('brand','model','size','position','quantity_fitted','serial_dot')) then raise exception 'INVALID_TYRE_DETAILS' using errcode='22023'; end if;
    insert into public.invoice_lines(invoice_id,revision_id,position,product_id,line_type,description,quantity,
      unit_price_incl_gst,discount_percent,discount_reason,discount_actor_user_id,discount_authorised_at,
      base_incl_gst,discount_amount,total_incl_gst,gst_amount,subtotal_ex_gst,gst_rate,
      pricing_basis,gst_treatment,unit_price_ex_gst,discount_type,discount_value,tyre_details)
    values(p_invoice_id,p_revision_id,pos,pid,lt,btrim(e->>'description'),qty,
      case when basis='inclusive' then price else round(price*(case when treatment='taxable' then 1.1 else 1 end),2) end,
      case when dtype='percent' then dvalue else 0 end,nullif(btrim(e->>'discount_reason'),''),
      case when dvalue>0 then p_actor end,case when dvalue>0 then now() end,
      case when basis='inclusive' then base else round(base*(case when treatment='taxable' then 1.1 else 1 end),2) end,
      discount,total,gst,ex,case when treatment='taxable' then 0.1000 else 0 end,
      basis,treatment,case when basis='exclusive' then price else round(price/(case when treatment='taxable' then 1.1 else 1 end),2) end,
      dtype,dvalue,tyre);
    header_ex:=header_ex+ex; header_gst:=header_gst+gst; header_total:=header_total+total;
  end loop;
  update public.invoice_revisions set subtotal_ex_gst=header_ex,gst_amount=header_gst,total_incl_gst=header_total,
    pricing_complete=true where id=p_revision_id;
end;
$$;

create function public.create_manual_invoice_v2(p_request_id uuid,p_location_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; iid uuid:=extensions.gen_random_uuid(); rid uuid:=extensions.gen_random_uuid(); number text;
  c public.customers%rowtype; v public.customer_vehicles%rowtype; terms text; result jsonb; replay jsonb; payload jsonb;
  issue date; due date; method text; jobs jsonb;
begin
  actor:=private.finance_guard('invoices.create',p_location_id); perform private.finance_guard('invoices.view',p_location_id);
  perform private.finance_json_keys(p_input,array['customer_id','customer_vehicle_id','payment_terms','issue_date','due_date',
    'customer_reference','customer_notes','internal_notes','payment_method','job_details','lines']);
  if p_input->>'customer_id' is not null then
    select * into c from public.customers where id=(p_input->>'customer_id')::uuid and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  end if;
  if p_input->>'customer_vehicle_id' is not null then
    select * into v from public.customer_vehicles where id=(p_input->>'customer_vehicle_id')::uuid and customer_id=c.id and active;
    if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  end if;
  select coalesce(nullif(p_input->>'payment_terms',''),fs.default_payment_terms,'7_days') into terms from public.finance_settings fs where fs.singleton;
  terms:=coalesce(terms,'7_days'); if terms not in ('due_on_receipt','7_days','14_days','30_days') then raise exception 'INVALID_PAYMENT_TERMS' using errcode='22023'; end if;
  begin issue:=nullif(p_input->>'issue_date','')::date; due:=nullif(p_input->>'due_date','')::date; exception when others then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end;
  if issue is not null and due is not null and due<issue then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end if;
  method:=nullif(p_input->>'payment_method',''); if method is not null and method not in ('bank_transfer','cash','card','eftpos','other') then raise exception 'INVALID_PAYMENT_METHOD' using errcode='22023'; end if;
  jobs:=private.finance_validate_job_details(p_input->'job_details');
  payload:=jsonb_build_object('location',p_location_id,'input',p_input); replay:=private.finance_request(p_request_id,'create_manual_invoice_v2',payload); if replay is not null then return replay; end if;
  number:=private.next_invoice_number(p_location_id);
  insert into public.invoices(id,invoice_number,location_id,customer_id,customer_vehicle_id,source_type,status,created_by)
  values(iid,number,p_location_id,c.id,v.id,'manual','draft',actor);
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,issue_date,due_date,payment_terms,
    customer_reference,customer_notes,internal_notes,payment_method,job_details,created_by)
  values(rid,iid,1,'draft',issue,due,terms,nullif(btrim(p_input->>'customer_reference'),''),nullif(btrim(p_input->>'customer_notes'),''),
    nullif(btrim(p_input->>'internal_notes'),''),method,jobs,actor);
  perform private.finance_write_v2_lines(iid,rid,p_input->'lines',p_location_id,actor);
  update public.invoices set current_revision_id=rid where id=iid;
  result:=jsonb_build_object('invoice_id',iid,'invoice_number',number,'revision_id',rid,'status','draft','version',1,'pricing_complete',true);
  perform private.sales_audit('INVOICE_CREATED','invoice',iid,p_location_id,jsonb_build_object('invoice_number',number,'source_type','manual_v2'));
  perform private.finance_request_finish(p_request_id,'create_manual_invoice_v2',payload,p_location_id,iid,result); return result;
end;
$$;

create function public.update_invoice_draft_v2(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; oldr public.invoice_revisions%rowtype; nr uuid:=extensions.gen_random_uuid(); actor uuid;
  payload jsonb; replay jsonb; result jsonb; jobs jsonb; terms text; issue date; due date; method text;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.edit',i.location_id); perform private.finance_guard('invoices.view',i.location_id);
  if i.source_type<>'manual' then
    if exists(select 1 from jsonb_array_elements(p_input->'lines') e where
      coalesce(e->>'pricing_basis','inclusive')<>'inclusive' or coalesce(e->>'gst_treatment','taxable')<>'taxable'
      or coalesce(e->>'discount_type','percent')<>'percent') then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    return public.update_invoice_draft(p_request_id,p_invoice_id,p_expected_version,
      jsonb_build_object('payment_terms',p_input->'payment_terms','customer_reference',p_input->'customer_reference',
        'customer_notes',p_input->'customer_notes','lines',(select jsonb_agg(jsonb_build_object(
          'id',e->'id','description',e->'description','quantity',e->'quantity','unit_price_incl_gst',e->'unit_price',
          'discount_percent',e->'discount_value','discount_reason',e->'discount_reason')) from jsonb_array_elements(p_input->'lines') e)));
  end if;
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'input',p_input); replay:=private.finance_request(p_request_id,'update_invoice_draft_v2',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if i.status<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  select * into oldr from public.invoice_revisions where id=i.current_revision_id;
  perform private.finance_json_keys(p_input,array['payment_terms','issue_date','due_date','customer_reference','customer_notes','internal_notes','payment_method','job_details','lines']);
  terms:=coalesce(nullif(p_input->>'payment_terms',''),oldr.payment_terms); issue:=coalesce(nullif(p_input->>'issue_date','')::date,oldr.issue_date); due:=coalesce(nullif(p_input->>'due_date','')::date,oldr.due_date);
  if due is not null and issue is not null and due<issue then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end if;
  method:=coalesce(nullif(p_input->>'payment_method',''),oldr.payment_method); jobs:=case when p_input ? 'job_details' then private.finance_validate_job_details(p_input->'job_details') else oldr.job_details end;
  -- Draft revisions are mutable, but replace them atomically so line additions/removals cannot leave partial totals.
  delete from public.invoice_lines where revision_id=oldr.id;
  update public.invoice_revisions set issue_date=issue,due_date=due,payment_terms=terms,
    customer_reference=case when p_input ? 'customer_reference' then nullif(btrim(p_input->>'customer_reference'),'') else customer_reference end,
    customer_notes=case when p_input ? 'customer_notes' then nullif(btrim(p_input->>'customer_notes'),'') else customer_notes end,
    internal_notes=case when p_input ? 'internal_notes' then nullif(btrim(p_input->>'internal_notes'),'') else internal_notes end,
    payment_method=method,job_details=jobs,version=version+1 where id=oldr.id;
  perform private.finance_write_v2_lines(i.id,oldr.id,p_input->'lines',i.location_id,actor);
  update public.invoices set version=version+1,updated_at=now() where id=i.id;
  result:=jsonb_build_object('invoice_id',i.id,'revision_id',oldr.id,'version',i.version+1,'pricing_complete',true);
  perform private.sales_audit('INVOICE_DRAFT_UPDATED','invoice',i.id,i.location_id,jsonb_build_object('version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'update_invoice_draft_v2',payload,i.location_id,i.id,result); return result;
end;
$$;

create function public.duplicate_invoice_draft(p_request_id uuid,p_invoice_id uuid,p_location_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; target uuid; payload jsonb; replay jsonb; input jsonb; result jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); target:=coalesce(p_location_id,i.location_id); perform private.finance_guard('invoices.create',target);
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'location_id',target); replay:=private.finance_request(p_request_id,'duplicate_invoice_draft',payload); if replay is not null then return replay; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id;
  input:=jsonb_build_object('customer_id',i.customer_id,'customer_vehicle_id',i.customer_vehicle_id,'payment_terms',r.payment_terms,
    'customer_reference',r.customer_reference,'customer_notes',r.customer_notes,'internal_notes',r.internal_notes,'payment_method',r.payment_method,
    'job_details',r.job_details,'lines',(select jsonb_agg(jsonb_build_object('line_type',l.line_type,'product_id',l.product_id,
      'description',l.description,'quantity',l.quantity,'unit_price',case when l.pricing_basis='exclusive' then l.unit_price_ex_gst else l.unit_price_incl_gst end,
      'pricing_basis',l.pricing_basis,'gst_treatment',l.gst_treatment,'discount_type',l.discount_type,
      'discount_value',case when l.unit_price_ex_gst is null then l.discount_percent else l.discount_value end,
      'discount_reason',l.discount_reason,'tyre_details',l.tyre_details) order by l.position) from public.invoice_lines l where l.revision_id=r.id));
  -- Child key makes the composed create independently idempotent.
  result:=public.create_manual_invoice_v2(private.finance_child_uuid(p_request_id,'duplicate',1),target,input);
  perform private.finance_request_finish(p_request_id,'duplicate_invoice_draft',payload,target,(result->>'invoice_id')::uuid,result); return result;
end;
$$;

create function public.void_issued_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; reason text:=nullif(btrim(p_reason),''); payload jsonb; replay jsonb; result jsonb; projection jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id; if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('invoices.cancel',i.location_id);
  if reason is null or length(reason)>500 then raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'reason',reason); replay:=private.finance_request(p_request_id,'void_issued_invoice',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  projection:=private.finance_invoice_projection(i.id,false);
  if (projection->>'effective_paid')::numeric<>0 or i.first_payment_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  update public.invoices set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=reason,version=version+1,updated_at=now() where id=i.id;
  result:=jsonb_build_object('invoice_id',i.id,'status','cancelled','version',i.version+1,'voided',true);
  perform private.sales_audit('INVOICE_VOIDED','invoice',i.id,i.location_id,jsonb_build_object('invoice_number',i.invoice_number,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'void_issued_invoice',payload,i.location_id,i.id,result); return result;
end;
$$;

create function public.invoice_summary_v2(p_location_id uuid default null,p_status text default null,p_source_type text default null,p_search text default null,
  p_sort text default 'created_at',p_direction text default 'desc',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; term text:=lower(nullif(btrim(p_search),''));
begin
  perform private.finance_guard('invoices.view',p_location_id);
  if p_status is not null and p_status not in ('draft','issued','cancelled','sent','partial','paid','overdue','void') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_source_type is not null and p_source_type not in ('job','pos','manual') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_sort not in ('created_at','invoice_number','customer_name','issue_date','due_date','total','balance','status') or p_direction not in ('asc','desc')
    or p_offset<0 or p_limit not between 1 and 100 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  with data as (
    select i.*,r.issue_date,r.due_date,r.total_incl_gst,r.gst_amount,r.subtotal_ex_gst,r.customer_reference,
      coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer') customer_name,
      private.finance_invoice_projection(i.id,false) financials
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
    where (private.app_is_admin() or i.location_id=private.app_user_location_id()) and (p_location_id is null or i.location_id=p_location_id)
      and (p_source_type is null or i.source_type=p_source_type)
      and (term is null or lower(concat_ws(' ',i.invoice_number,c.display_name,r.customer_snapshot->>'display_name',r.customer_reference,r.job_details->>'registration',r.job_details->>'vehicle_or_fleet_id')) like '%'||term||'%')
  ), filtered as (
    select *,case when status='cancelled' then 'void' when status='draft' then 'draft'
      when (financials->>'payment_state')='paid' then 'paid' when (financials->>'payment_state')='partial' then 'partial'
      when (financials->>'is_overdue')::boolean then 'overdue' else 'sent' end display_status from data
  ), chosen as (select * from filtered where p_status is null or status=p_status or display_status=p_status)
  select count(*) into total from chosen;
  with data as (
    select i.*,r.issue_date,r.due_date,r.total_incl_gst,r.gst_amount,r.subtotal_ex_gst,r.customer_reference,
      coalesce(r.customer_snapshot->>'display_name',c.display_name,'Walk-In Customer') customer_name,private.finance_invoice_projection(i.id,false) financials
    from public.invoices i join public.invoice_revisions r on r.id=i.current_revision_id left join public.customers c on c.id=i.customer_id
    where (private.app_is_admin() or i.location_id=private.app_user_location_id()) and (p_location_id is null or i.location_id=p_location_id)
      and (p_source_type is null or i.source_type=p_source_type)
      and (term is null or lower(concat_ws(' ',i.invoice_number,c.display_name,r.customer_snapshot->>'display_name',r.customer_reference,r.job_details->>'registration',r.job_details->>'vehicle_or_fleet_id')) like '%'||term||'%')
  ), filtered as (
    select *,case when status='cancelled' then 'void' when status='draft' then 'draft' when (financials->>'payment_state')='paid' then 'paid'
      when (financials->>'payment_state')='partial' then 'partial' when (financials->>'is_overdue')::boolean then 'overdue' else 'sent' end display_status from data
  ), chosen as (select * from filtered where p_status is null or status=p_status or display_status=p_status), page as (
    select * from chosen order by
      case when p_direction='asc' and p_sort='created_at' then created_at end asc,case when p_direction='desc' and p_sort='created_at' then created_at end desc,
      case when p_direction='asc' and p_sort='invoice_number' then invoice_number end asc,case when p_direction='desc' and p_sort='invoice_number' then invoice_number end desc,
      case when p_direction='asc' and p_sort='customer_name' then customer_name end asc,case when p_direction='desc' and p_sort='customer_name' then customer_name end desc,
      case when p_direction='asc' and p_sort='issue_date' then issue_date end asc,case when p_direction='desc' and p_sort='issue_date' then issue_date end desc,
      case when p_direction='asc' and p_sort='due_date' then due_date end asc,case when p_direction='desc' and p_sort='due_date' then due_date end desc,
      case when p_direction='asc' and p_sort='total' then total_incl_gst end asc,case when p_direction='desc' and p_sort='total' then total_incl_gst end desc,
      case when p_direction='asc' and p_sort='balance' then (financials->>'balance')::numeric end asc,case when p_direction='desc' and p_sort='balance' then (financials->>'balance')::numeric end desc,
      case when p_direction='asc' and p_sort='status' then display_status end asc,case when p_direction='desc' and p_sort='status' then display_status end desc,id
    offset p_offset limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'invoice_number',invoice_number,'location_id',location_id,'customer_id',customer_id,
    'customer_name',customer_name,'source_type',source_type,'status',status,'display_status',display_status,'issue_date',issue_date,'due_date',due_date,
    'subtotal_ex_gst',subtotal_ex_gst,'gst_amount',gst_amount,'total_incl_gst',total_incl_gst,'effective_paid',financials->'effective_paid',
    'balance',financials->'balance','version',version,'created_at',created_at) order by array_position(array(select id from page),id)),'[]'::jsonb) into rows from page;
  return jsonb_build_object('rows',rows,'total',total,'offset',p_offset,'limit',p_limit);
end;
$$;

-- Retain explicitly entered manual dates when issuing the immutable snapshot.
create or replace function public.issue_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; snap jsonb; dates jsonb; ctype text;
  payload jsonb; replay jsonb; result jsonb; doc_number text;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.issue',i.location_id);
  payload:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version);
  replay:=private.finance_request(p_request_id,'issue_invoice',payload);
  if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if i.status<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  select * into r from public.invoice_revisions where id=i.current_revision_id for update;
  if r.lifecycle<>'draft' then raise exception 'INVOICE_NOT_DRAFT' using errcode='22023'; end if;
  if not r.pricing_complete then raise exception 'INVOICE_PRICE_PENDING' using errcode='22023'; end if;
  if not exists(select 1 from public.invoice_lines where revision_id=r.id) then raise exception 'INVOICE_LINES_REQUIRED' using errcode='22023'; end if;
  snap:=private.finance_issue_snapshots(p_invoice_id);
  ctype:=coalesce(snap->'customer'->>'customer_type',case when i.customer_id is null then 'walk_in' else 'individual' end);
  dates:=private.finance_due_date(r.payment_terms,ctype);
  if i.source_type='manual' then
    dates:=dates||jsonb_build_object('issue_date',coalesce(r.issue_date,(dates->>'issue_date')::date),
      'due_date',coalesce(r.due_date,coalesce(r.issue_date,(dates->>'issue_date')::date)
        + case dates->>'payment_terms' when '7_days' then 7 when '14_days' then 14 when '30_days' then 30 else 0 end));
    if (dates->>'due_date')::date < (dates->>'issue_date')::date then raise exception 'INVALID_INVOICE_DATE' using errcode='22023'; end if;
  end if;
  update public.invoice_revisions set lifecycle='issued',issued_at=pg_catalog.now(),
    issue_date=(dates->>'issue_date')::date,due_date=(dates->>'due_date')::date,payment_terms=dates->>'payment_terms',
    business_snapshot=snap->'business',branch_snapshot=snap->'branch',customer_snapshot=snap->'customer',
    billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',
    version=version+1 where id=r.id;
  update public.invoices set status='issued',first_issued_at=coalesce(first_issued_at,pg_catalog.now()),version=version+1 where id=p_invoice_id;
  doc_number:=case when r.revision_number=1 then i.invoice_number else i.invoice_number||'-R'||r.revision_number end;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version)
  values(p_invoice_id,i.location_id,r.id,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||r.id::text||'/v1',
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',r.revision_number,'issue_date',dates->>'issue_date',
      'due_date',dates->>'due_date','business',snap->'business','branch',snap->'branch','customer',snap->'customer',
      'vehicle',snap->'vehicle','total_incl_gst',r.total_incl_gst,'gst_amount',r.gst_amount,'subtotal_ex_gst',r.subtotal_ex_gst),'v1')
  on conflict (invoice_revision_id,document_type) where document_type='tax_invoice' do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'status','issued','version',i.version+1,'revision_id',r.id,
    'issue_date',dates->>'issue_date','due_date',dates->>'due_date');
  perform private.sales_audit('INVOICE_ISSUED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',r.revision_number,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'issue_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

-- Preserve manual GST and structured metadata when creating immutable revisions.
create or replace function public.revise_unpaid_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; i public.invoices%rowtype; cur public.invoice_revisions%rowtype; nrid uuid:=extensions.gen_random_uuid();
  nrev integer; reason text; specs jsonb:='[]'::jsonb; existing public.invoice_lines%rowtype; row jsonb; pos integer:=0;
  disc numeric; terms text; snap jsonb; dates jsonb; ctype text; payload jsonb; replay jsonb; result jsonb; doc_number text;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.edit',i.location_id);
  perform private.finance_guard('invoices.issue',i.location_id);
  perform private.finance_json_keys(p_input,array['revision_reason','payment_terms','customer_reference','customer_notes','lines']);
  reason:=nullif(btrim(p_input->>'revision_reason'),'');
  if reason is null or length(reason)>500 then raise exception 'REVISION_REASON_REQUIRED' using errcode='22023'; end if;
  payload:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'input',p_input);
  replay:=private.finance_request(p_request_id,'revise_unpaid_invoice',payload);
  if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if i.status<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  if i.first_payment_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  select * into cur from public.invoice_revisions where id=i.current_revision_id;
  select coalesce(max(revision_number),0)+1 into nrev from public.invoice_revisions where invoice_id=p_invoice_id;
  terms:=coalesce(nullif(p_input->>'payment_terms',''),cur.payment_terms);
  insert into public.invoice_revisions(id,invoice_id,revision_number,lifecycle,payment_terms,
    customer_reference,customer_notes,source_job_number,source_quote_number,revision_reason,created_by)
  values(nrid,p_invoice_id,nrev,'draft',terms,
    coalesce(nullif(btrim(p_input->>'customer_reference'),''),cur.customer_reference),
    coalesce(nullif(btrim(p_input->>'customer_notes'),''),cur.customer_notes),cur.source_job_number,cur.source_quote_number,reason,actor);
  for existing in select * from public.invoice_lines where revision_id=cur.id order by position loop
    pos:=pos+1;
    row:=coalesce((select value from pg_catalog.jsonb_array_elements(coalesce(p_input->'lines','[]'::jsonb)) value
      where (value->>'id')::uuid=existing.id),'{}'::jsonb);
    if i.source_type='manual' then
      specs:=specs||jsonb_build_object('line_type',existing.line_type,'product_id',existing.product_id,
        'description',coalesce(nullif(btrim(row->>'description'),''),existing.description),
        'quantity',coalesce(row->>'quantity',existing.quantity::text),
        'unit_price',coalesce(row->>'unit_price',row->>'unit_price_incl_gst',
          case when existing.pricing_basis='exclusive' then existing.unit_price_ex_gst::text else existing.unit_price_incl_gst::text end),
        'pricing_basis',coalesce(row->>'pricing_basis',existing.pricing_basis),
        'gst_treatment',coalesce(row->>'gst_treatment',existing.gst_treatment),
        'discount_type',coalesce(row->>'discount_type',existing.discount_type),
        'discount_value',coalesce(row->>'discount_value',row->>'discount_percent',
          case when existing.unit_price_ex_gst is null then existing.discount_percent::text else existing.discount_value::text end),
        'discount_reason',coalesce(row->>'discount_reason',existing.discount_reason),
        'tyre_details',coalesce(row->'tyre_details',existing.tyre_details));
      continue;
    end if;
    if coalesce(row->>'pricing_basis','inclusive')<>'inclusive' or coalesce(row->>'gst_treatment','taxable')<>'taxable'
      or coalesce(row->>'discount_type','percent')<>'percent' then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    disc:=private.finance_discount(coalesce(row->>'discount_value',row->>'discount_percent',existing.discount_percent::text),
      coalesce(row->>'discount_reason',existing.discount_reason),'invoices.edit',i.location_id);
    specs:=specs||pg_catalog.jsonb_build_object('position',pos,'source_job_line_id',existing.source_job_line_id,
      'product_id',existing.product_id,'used_tyre_unit_id',existing.used_tyre_unit_id,'line_type',existing.line_type,
      'description',case when existing.source_job_line_id is not null
        then coalesce(nullif(btrim(row->>'description'),''),existing.description)
        else coalesce(nullif(btrim(row->>'description'),''),existing.description) end,
      'quantity',case when existing.source_job_line_id is not null then existing.quantity::text
        else coalesce(nullif(row->>'quantity',''),existing.quantity::text) end,
      'unit_price',case when existing.source_job_line_id is not null then existing.unit_price_incl_gst::text
        when row ? 'unit_price_incl_gst' then row->>'unit_price_incl_gst' else existing.unit_price_incl_gst::text end,
      'discount_percent',disc::text,
      'discount_reason',case when disc>0 then coalesce(btrim(row->>'discount_reason'),existing.discount_reason) else null end,
      'discount_actor',case when disc>0 then actor else null end,
      'discount_authorised_at',case when disc>0 then pg_catalog.now() else null end,
      'inventory_movement_id',(select c.inventory_movement_id from public.invoice_line_costs c where c.invoice_line_id=existing.id),
      'captured_unit_cost',(select c.captured_unit_cost::text from public.invoice_line_costs c where c.invoice_line_id=existing.id),
      'capture_source',(select c.capture_source from public.invoice_line_costs c where c.invoice_line_id=existing.id));
  end loop;
  update public.invoice_revisions set internal_notes=cur.internal_notes,payment_method=cur.payment_method,job_details=cur.job_details where id=nrid;
  if i.source_type='manual' then
    perform private.finance_write_v2_lines(p_invoice_id,nrid,specs,i.location_id,actor);
  else
    perform private.finance_write_revision_lines(p_invoice_id,nrid,specs);
  end if;
  select * into cur from public.invoice_revisions where id=nrid;
  if not cur.pricing_complete then raise exception 'INVOICE_PRICE_PENDING' using errcode='22023'; end if;
  snap:=private.finance_issue_snapshots(p_invoice_id);
  ctype:=coalesce(snap->'customer'->>'customer_type',case when i.customer_id is null then 'walk_in' else 'individual' end);
  dates:=private.finance_due_date(terms,ctype);
  update public.invoice_revisions set lifecycle='issued',issued_at=pg_catalog.now(),
    issue_date=coalesce((select issue_date from public.invoice_revisions where invoice_id=p_invoice_id and revision_number=1),(dates->>'issue_date')::date),
    due_date=(select coalesce((select issue_date from public.invoice_revisions where invoice_id=p_invoice_id and revision_number=1),(dates->>'issue_date')::date))
      + case dates->>'payment_terms' when 'due_on_receipt' then 0 when '7_days' then 7 when '14_days' then 14 when '30_days' then 30 end,
    payment_terms=dates->>'payment_terms',
    business_snapshot=snap->'business',branch_snapshot=snap->'branch',customer_snapshot=snap->'customer',
    billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',version=version+1 where id=nrid;
  update public.invoices set current_revision_id=nrid,version=version+1 where id=p_invoice_id;
  select * into cur from public.invoice_revisions where id=nrid;
  doc_number:=i.invoice_number||'-R'||nrev;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version)
  values(p_invoice_id,i.location_id,nrid,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||nrid::text||'/v1',
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'issue_date',cur.issue_date,'due_date',cur.due_date,
      'revision_reason',reason,'total_incl_gst',cur.total_incl_gst,'gst_amount',cur.gst_amount,'subtotal_ex_gst',cur.subtotal_ex_gst),'v1')
  on conflict (invoice_revision_id,document_type) where document_type='tax_invoice' do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'revision_id',nrid,'revision_number',nrev,'version',i.version+1,
    'issue_date',cur.issue_date,'due_date',cur.due_date);
  perform private.sales_audit('INVOICE_REVISED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'revise_unpaid_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end;
$$;

-- Immutable audit trail for explicit invoice email attempts. Provider secrets are
-- intentionally absent; only provider metadata and the failure outcome are kept.
create table public.invoice_email_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  invoice_revision_id uuid not null references public.invoice_revisions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  recipient text not null check (recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  sender text not null check (btrim(sender) <> ''),
  attempted_at timestamptz not null default now(),
  provider text not null check (btrim(provider) <> ''),
  provider_message_id text,
  delivery_state text not null check (delivery_state in ('sent','failed','disabled')),
  error_message text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  retry_of uuid references public.invoice_email_deliveries(id) on delete restrict
);
alter table public.invoice_email_deliveries enable row level security;
revoke all on public.invoice_email_deliveries from public,anon,authenticated,service_role;
create index invoice_email_deliveries_invoice_idx on public.invoice_email_deliveries(invoice_id, attempted_at desc);
create trigger invoice_email_deliveries_immutable before update or delete on public.invoice_email_deliveries for each row execute function private.finance_immutable();
create trigger invoice_email_deliveries_no_truncate before truncate on public.invoice_email_deliveries for each statement execute function private.finance_immutable();
create or replace function public.record_invoice_email_delivery(
  p_invoice_id uuid,p_invoice_revision_id uuid,p_recipient text,p_sender text,p_provider text,
  p_delivery_state text,p_provider_message_id text default null,p_error_message text default null,p_retry_of uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; r public.invoice_revisions%rowtype; actor uuid; delivery_id uuid;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('documents.send',i.location_id);
  select * into r from public.invoice_revisions where id=p_invoice_revision_id and invoice_id=i.id;
  if not found or i.status<>'issued' or r.lifecycle<>'issued' then raise exception 'INVOICE_NOT_ISSUED' using errcode='22023'; end if;
  if p_retry_of is not null and not exists(select 1 from public.invoice_email_deliveries d
    where d.id=p_retry_of and d.invoice_id=i.id and d.invoice_revision_id=r.id) then
    raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_delivery_state not in ('sent','failed','disabled') or p_provider not in ('resend','disabled') then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_delivery_state='sent' and (p_provider_message_id is null or p_error_message is not null) then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  insert into public.invoice_email_deliveries(invoice_id,invoice_revision_id,revision_number,recipient,sender,provider,provider_message_id,delivery_state,error_message,actor_user_id,retry_of)
    values(i.id,r.id,r.revision_number,lower(btrim(p_recipient)),btrim(p_sender),p_provider,p_provider_message_id,p_delivery_state,left(nullif(btrim(p_error_message),''),2000),actor,p_retry_of)
    returning id into delivery_id;
  return jsonb_build_object('id',delivery_id,'delivery_state',p_delivery_state);
end; $$;
revoke execute on function public.record_invoice_email_delivery(uuid,uuid,text,text,text,text,text,text,uuid) from public,anon,service_role;
grant execute on function public.record_invoice_email_delivery(uuid,uuid,text,text,text,text,text,text,uuid) to authenticated;

-- Expose richer snapshots/line metadata without exposing restricted cost data.
create or replace function public.invoice_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i public.invoices%rowtype; revisions jsonb; documents jsonb:='[]'; email_deliveries jsonb:='[]'; projection jsonb; can_payments boolean; can_send boolean;
begin
  perform private.finance_guard('invoices.view'); select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if; perform private.finance_guard('invoices.view',i.location_id);
  can_payments:=private.app_has_permission('payments.view'); can_send:=private.app_has_permission('documents.send');
  select jsonb_agg(jsonb_build_object('id',r.id,'revision_number',r.revision_number,'lifecycle',r.lifecycle,'issued_at',r.issued_at,
    'issue_date',r.issue_date,'due_date',r.due_date,'payment_terms',r.payment_terms,'total_incl_gst',r.total_incl_gst,
    'subtotal_ex_gst',r.subtotal_ex_gst,'gst_amount',r.gst_amount,'pricing_complete',r.pricing_complete,'revision_reason',r.revision_reason,
    'customer_reference',r.customer_reference,'customer_notes',r.customer_notes,'internal_notes',r.internal_notes,'payment_method',r.payment_method,
    'job_details',r.job_details,'customer_snapshot',r.customer_snapshot,'vehicle_snapshot',r.vehicle_snapshot,'business_snapshot',r.business_snapshot,
    'branch_snapshot',r.branch_snapshot,'billing_contact_snapshot',r.billing_contact_snapshot,'lines',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',l.id,'position',l.position,'line_type',l.line_type,'description',l.description,'quantity',l.quantity,'product_id',l.product_id,
      'unit_price_incl_gst',l.unit_price_incl_gst,'unit_price_ex_gst',l.unit_price_ex_gst,'pricing_basis',l.pricing_basis,
      'gst_treatment',l.gst_treatment,'discount_type',l.discount_type,'discount_value',l.discount_value,'discount_percent',l.discount_percent,
      'discount_reason',l.discount_reason,'discount_amount',l.discount_amount,'subtotal_ex_gst',l.subtotal_ex_gst,'gst_amount',l.gst_amount,
      'total_incl_gst',l.total_incl_gst,'tyre_details',l.tyre_details,'source_job_line_id',l.source_job_line_id,'used_tyre_unit_id',l.used_tyre_unit_id
    ) order by l.position),'[]') from public.invoice_lines l where l.revision_id=r.id)) order by r.revision_number) into revisions
  from public.invoice_revisions r where r.invoice_id=i.id;
  if can_payments then select coalesce(jsonb_agg(to_jsonb(d)-'snapshot' order by d.created_at),'[]') into documents from public.financial_documents d where d.invoice_id=i.id; end if;
  if can_send then select coalesce(jsonb_agg(to_jsonb(d) order by d.attempted_at desc),'[]') into email_deliveries from public.invoice_email_deliveries d where d.invoice_id=i.id; end if;
  projection:=private.finance_invoice_projection(i.id,can_payments);
  return to_jsonb(i)||jsonb_build_object('revisions',coalesce(revisions,'[]'),'documents',documents,'financials',projection-'payments',
    'payments',case when can_payments then projection->'payments' else '[]'::jsonb end,'email_deliveries',email_deliveries);
end;
$$;

-- A stale version is a client conflict, not a serialisation retry. This also
-- covers concurrent manual payment submissions against the same invoice.
create or replace function public.update_finance_settings(p_request_id uuid,p_expected_version integer,p_location_id uuid,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); allowed text[]; key text; normalized jsonb:='{}'; value jsonb;
  payload jsonb; replay jsonb; result jsonb; old_version integer; next_version integer;
begin
  if not private.app_is_admin() then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if p_expected_version is null or p_expected_version<0 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if p_location_id is not null and not exists(select 1 from public.locations l where l.id=p_location_id and l.active) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  allowed:=case when p_location_id is null then array['business_name','abn','address','phone','shared_email','logo_asset_path','logo_sha256','bank_instructions','invoice_footer'] else array['branch_name','address','phone','contact_email','document_footer'] end;
  perform private.finance_json_keys(p_settings,allowed);
  foreach key in array allowed loop
    value:=p_settings->key;
    if value is null or value='null'::jsonb then normalized:=normalized||pg_catalog.jsonb_build_object(key,null); continue; end if;
    if key in ('address','bank_instructions') then
      perform private.finance_json_keys(value,case when key='address' then array['street_address','suburb','state','postcode','country'] else array['bank_name','account_name','bsb','account_number','payment_reference','instructions'] end);
      if exists(select 1 from pg_catalog.jsonb_each(value) e where pg_catalog.jsonb_typeof(e.value) not in ('string','null') or length(e.value::text)>2000) then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
    else
      if pg_catalog.jsonb_typeof(value)<>'string' or length(value #>> '{}')>2000 then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
      value:=pg_catalog.to_jsonb(nullif(btrim(value #>> '{}'),''));
    end if;
    normalized:=normalized||pg_catalog.jsonb_build_object(key,value);
  end loop;
  if normalized->>'abn' is not null and normalized->>'abn' !~ '^[0-9]{11}$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if normalized->>'logo_sha256' is not null and normalized->>'logo_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if normalized->>'logo_asset_path' ~ '(^/|(^|/)\.\.(/|$)|://)' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  if coalesce(normalized->>'shared_email',normalized->>'contact_email') is not null and coalesce(normalized->>'shared_email',normalized->>'contact_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_FINANCE_INPUT' using errcode='22023'; end if;
  payload:=pg_catalog.jsonb_build_object('version',p_expected_version,'location',p_location_id,'settings',normalized);
  replay:=private.finance_request(p_request_id,'update_finance_settings',payload); if replay is not null then return replay; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-settings:'||coalesce(p_location_id::text,'global'),0));
  if p_location_id is null then select s.version into old_version from public.finance_settings s where s.singleton for update; else select s.version into old_version from public.finance_location_settings s where s.location_id=p_location_id for update; end if;
  if coalesce(old_version,0)<>p_expected_version then raise exception 'FINANCE_VERSION_CONFLICT' using errcode='PT409'; end if;
  next_version:=coalesce(old_version,0)+1;
  if p_location_id is null then
    insert into public.finance_settings(singleton,business_name,abn,address,phone,shared_email,logo_asset_path,logo_sha256,bank_instructions,invoice_footer,updated_by,version) values(true,normalized->>'business_name',normalized->>'abn',nullif(normalized->'address','null'::jsonb),normalized->>'phone',normalized->>'shared_email',normalized->>'logo_asset_path',normalized->>'logo_sha256',nullif(normalized->'bank_instructions','null'::jsonb),normalized->>'invoice_footer',actor,next_version) on conflict (singleton) do update set business_name=excluded.business_name,abn=excluded.abn,address=excluded.address,phone=excluded.phone,shared_email=excluded.shared_email,logo_asset_path=excluded.logo_asset_path,logo_sha256=excluded.logo_sha256,bank_instructions=excluded.bank_instructions,invoice_footer=excluded.invoice_footer,updated_by=actor,version=next_version,updated_at=now();
  else
    insert into public.finance_location_settings(location_id,branch_name,address,phone,contact_email,document_footer,updated_by,version) values(p_location_id,normalized->>'branch_name',nullif(normalized->'address','null'::jsonb),normalized->>'phone',normalized->>'contact_email',normalized->>'document_footer',actor,next_version) on conflict (location_id) do update set branch_name=excluded.branch_name,address=excluded.address,phone=excluded.phone,contact_email=excluded.contact_email,document_footer=excluded.document_footer,updated_by=actor,version=next_version,updated_at=now();
  end if;
  result:=pg_catalog.jsonb_build_object('version',next_version);
  perform private.sales_audit('FINANCE_SETTINGS_UPDATED','finance_settings',p_location_id,p_location_id,pg_catalog.jsonb_build_object('request_id',p_request_id,'version',next_version,'changed_fields',allowed));
  perform private.finance_request_finish(p_request_id,'update_finance_settings',payload,p_location_id,p_location_id,result);
  return result;
end;
$$;

create or replace function public.update_quote_draft(p_quote_id uuid,p_expected_version integer,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes%rowtype; c public.customers%rowtype; v public.customer_vehicles%rowtype; row jsonb; pos integer:=0; product public.products%rowtype; qty numeric; price numeric; line_total numeric; total numeric:=0; complete boolean:=true; result jsonb;
begin
  if not (select private.sales_permission('quotes.edit')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if q.version<>p_expected_version then raise exception 'QUOTE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if q.status<>'draft' then raise exception 'QUOTE_NOT_EDITABLE' using errcode='22023'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  select * into c from public.customers where id=q.customer_id and active;
  if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
  if q.customer_vehicle_id is not null then select * into v from public.customer_vehicles where id=q.customer_vehicle_id and customer_id=q.customer_id and active; if not found then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if; end if;
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

create or replace function public.record_invoice_payment(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_tenders jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; payload jsonb; replay jsonb; result jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id); perform private.finance_guard('payments.view',i.location_id);
  perform private.finance_guard('payments.record',i.location_id);
  payload:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'tenders',p_tenders);
  replay:=private.finance_request(p_request_id,'record_invoice_payment',payload); if replay is not null then return replay; end if;
  select * into i from public.invoices where id=p_invoice_id for update;
  if i.version<>p_expected_version then raise exception 'INVOICE_VERSION_CONFLICT' using errcode='PT409'; end if;
  result:=private.finance_record_tenders(p_request_id,p_invoice_id,p_tenders);
  perform private.finance_request_finish(p_request_id,'record_invoice_payment',payload,i.location_id,i.id,result);
  return result;
end;
$$;

revoke execute on function private.next_invoice_number(uuid),private.finance_validate_job_details(jsonb),private.finance_write_v2_lines(uuid,uuid,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.create_manual_invoice_v2(uuid,uuid,jsonb),public.update_invoice_draft_v2(uuid,uuid,integer,jsonb),
  public.duplicate_invoice_draft(uuid,uuid,uuid),public.void_issued_invoice(uuid,uuid,integer,text),
  public.invoice_summary_v2(uuid,text,text,text,text,text,integer,integer) from public,anon,service_role;
grant execute on function public.create_manual_invoice_v2(uuid,uuid,jsonb),public.update_invoice_draft_v2(uuid,uuid,integer,jsonb),
  public.duplicate_invoice_draft(uuid,uuid,uuid),public.void_issued_invoice(uuid,uuid,integer,text),
  public.invoice_summary_v2(uuid,text,text,text,text,text,integer,integer) to authenticated;
