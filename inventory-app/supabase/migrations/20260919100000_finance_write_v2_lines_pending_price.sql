-- Fixes a production-reachable defect found during the 2026-09-19 hardening
-- pass (see docs/receipt-cost-correction-decision.md's sibling finding in
-- that session's final report): the manual-invoice form still lets a user
-- submit a line with a blank price (lib/finance/invoice-schemas.ts's
-- unit_price is optionalMoney, transformed to null), and
-- createManualInvoiceAction/updateInvoiceDraftAction pass that straight
-- through to create_manual_invoice_v2/update_invoice_draft_v2 -- but
-- private.finance_write_v2_lines called private.finance_decimal on every
-- line's price unconditionally, which raises INVALID_DECIMAL for a null
-- input, and both wrapper RPCs hardcoded 'pricing_complete': true in their
-- return regardless of what was actually written. So a user submitting that
-- form with a blank price got a hard error instead of a priced-later draft.
--
-- The superseded v1 create_manual_invoice (revoked from authenticated in
-- 20260919098000_revoke_remaining_obsolete_rpc_authenticated_execute.sql,
-- unreachable from the app since it switched to v2 well before this pass)
-- supported this via private.finance_write_revision_lines: if ANY line in
-- the invoice lacks a price, EVERY line is still inserted with whatever
-- values it individually has (a priced line keeps its computed totals, an
-- unpriced line gets null money columns), but the header
-- (total_incl_gst/subtotal_ex_gst/gst_amount) collapses to null and
-- pricing_complete=false for the whole revision -- invoice_revisions_check
-- requires exactly that: pricing_complete=false must coincide with all
-- three header columns being null, never a partial sum. This migration
-- restores that same all-or-nothing behavior in finance_write_v2_lines,
-- which create_manual_invoice_v2, update_invoice_draft_v2, and
-- private.finance_revise_uncredited_invoice (revise_unpaid_invoice) all
-- share.
--
-- private.finance_revise_uncredited_invoice already reads the resulting
-- pricing_complete column back and raises INVOICE_PRICE_PENDING if it is
-- false (an issued invoice being revised must remain fully priced) -- that
-- check has been dead code since v2 shipped, since the writer always
-- reported pricing_complete=true. It starts working correctly the moment
-- the writer is fixed, with no change needed in that function itself.
--
-- A pending line's discount_value/discount_percent input is intentionally
-- ignored (stored as the column defaults, 0) rather than preserved-but-
-- unapplied as v1 did: there is no base amount to discount without a price,
-- and forcing zero avoids the ambiguity of a stored-but-never-audited
-- discount sitting against an undefined total. Once a line is later
-- (re)submitted with a price -- update_invoice_draft_v2 always replaces
-- every line from the full input each call -- its discount is validated
-- and audited normally via private.finance_discount, same as any other
-- priced line.
create or replace function private.finance_write_v2_lines(p_invoice_id uuid, p_revision_id uuid, p_lines jsonb, p_location_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare e jsonb; pos integer:=0; qty numeric; price numeric; basis text; treatment text;
  dtype text; dvalue numeric; base numeric; discount numeric; ex numeric; gst numeric; total numeric;
  pid uuid; lt text; tyre jsonb; header_ex numeric:=0; header_gst numeric:=0; header_total numeric:=0;
  any_pending boolean:=false;
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
    basis:=coalesce(e->>'pricing_basis','exclusive'); treatment:=coalesce(e->>'gst_treatment','taxable');
    dtype:=coalesce(e->>'discount_type',case when e ? 'discount_percent' then 'percent' else 'percent' end);
    if basis not in ('exclusive','inclusive') or treatment not in ('taxable','gst_free') or dtype not in ('percent','fixed') then
      raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
    tyre:=coalesce(e->'tyre_details','{}'::jsonb);
    if jsonb_typeof(tyre)<>'object' or exists(select 1 from jsonb_object_keys(tyre) k where k not in
      ('brand','model','size','position','quantity_fitted','serial_dot')) then raise exception 'INVALID_TYRE_DETAILS' using errcode='22023'; end if;

    if coalesce(e->>'unit_price',e->>'unit_price_incl_gst') is null then
      any_pending:=true;
      insert into public.invoice_lines(invoice_id,revision_id,position,product_id,line_type,description,quantity,
        gst_rate,pricing_basis,gst_treatment,discount_type,tyre_details)
      values(p_invoice_id,p_revision_id,pos,pid,lt,btrim(e->>'description'),qty,
        case when treatment='taxable' then 0.1000 else 0 end,basis,treatment,dtype,tyre);
      continue;
    end if;

    price:=private.finance_decimal(coalesce(e->>'unit_price',e->>'unit_price_incl_gst'),2,14);
    dvalue:=private.finance_decimal(coalesce(e->>'discount_value',e->>'discount_percent','0'),2,14);
    if dtype='percent' and dvalue>100 then raise exception 'INVALID_FINANCE_LINE' using errcode='22023'; end if;
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

  if any_pending then
    update public.invoice_revisions set subtotal_ex_gst=null,gst_amount=null,total_incl_gst=null,
      pricing_complete=false where id=p_revision_id;
  else
    update public.invoice_revisions set subtotal_ex_gst=header_ex,gst_amount=header_gst,total_incl_gst=header_total,
      pricing_complete=true where id=p_revision_id;
  end if;
end;
$$;

-- Both wrappers hardcoded 'pricing_complete': true in their own return
-- regardless of what the writer actually recorded; now that the writer can
-- report false, read the real column back instead.
create or replace function public.create_manual_invoice_v2(p_request_id uuid, p_location_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid; iid uuid:=extensions.gen_random_uuid(); rid uuid:=extensions.gen_random_uuid(); number text;
  c public.customers%rowtype; v public.customer_vehicles%rowtype; terms text; result jsonb; replay jsonb; payload jsonb;
  issue date; due date; method text; jobs jsonb; complete boolean;
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
  select r.pricing_complete into complete from public.invoice_revisions r where r.id=rid;
  result:=jsonb_build_object('invoice_id',iid,'invoice_number',number,'revision_id',rid,'status','draft','version',1,'pricing_complete',complete);
  perform private.sales_audit('INVOICE_CREATED','invoice',iid,p_location_id,jsonb_build_object('invoice_number',number,'source_type','manual_v2'));
  perform private.finance_request_finish(p_request_id,'create_manual_invoice_v2',payload,p_location_id,iid,result); return result;
end;
$$;

create or replace function public.update_invoice_draft_v2(p_request_id uuid, p_invoice_id uuid, p_expected_version integer, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare i public.invoices%rowtype; oldr public.invoice_revisions%rowtype; nr uuid:=extensions.gen_random_uuid(); actor uuid;
  payload jsonb; replay jsonb; result jsonb; jobs jsonb; terms text; issue date; due date; method text; complete boolean;
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
  select r.pricing_complete into complete from public.invoice_revisions r where r.id=oldr.id;
  result:=jsonb_build_object('invoice_id',i.id,'revision_id',oldr.id,'version',i.version+1,'pricing_complete',complete);
  perform private.sales_audit('INVOICE_DRAFT_UPDATED','invoice',i.id,i.location_id,jsonb_build_object('version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'update_invoice_draft_v2',payload,i.location_id,i.id,result); return result;
end;
$$;
