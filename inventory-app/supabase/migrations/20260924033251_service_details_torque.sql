-- Customer-facing service details and recorded (never recommended) torque.
-- All additions are nullable so historical documents remain valid.
alter table public.quotes add column extra_description text;
alter table public.jobs add column extra_description text;
alter table public.invoice_revisions add column extra_description text;

alter table public.quote_lines add column torque_nm numeric(9,2);
alter table public.job_lines add column torque_nm numeric(9,2);
alter table public.invoice_lines add column torque_nm numeric(9,2);

alter table public.quote_lines add constraint quote_lines_torque_positive check (torque_nm is null or torque_nm > 0);
alter table public.job_lines add constraint job_lines_torque_positive check (torque_nm is null or torque_nm > 0);
alter table public.invoice_lines add constraint invoice_lines_torque_positive check (torque_nm is null or torque_nm > 0);
alter table public.quotes add constraint quotes_extra_description_length check (extra_description is null or length(extra_description) <= 10000);
alter table public.jobs add constraint jobs_extra_description_length check (extra_description is null or length(extra_description) <= 10000);
alter table public.invoice_revisions add constraint invoice_revisions_extra_description_length check (extra_description is null or length(extra_description) <= 10000);

create or replace function private.sales_torque_value(p_value jsonb)
returns numeric(9,2) language plpgsql immutable set search_path='' as $$
declare raw text; parsed numeric;
begin
  if p_value is null or p_value='null'::jsonb then return null; end if;
  if jsonb_typeof(p_value) not in ('number','string') then raise exception 'INVALID_TORQUE' using errcode='22023'; end if;
  raw:=nullif(btrim(p_value #>> '{}'),''); if raw is null then return null; end if;
  if raw !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'INVALID_TORQUE' using errcode='22023'; end if;
  parsed:=raw::numeric; if parsed<=0 then raise exception 'INVALID_TORQUE' using errcode='22023'; end if;
  return parsed::numeric(9,2);
end; $$;
revoke all on function private.sales_torque_value(jsonb) from public,anon,authenticated,service_role;
-- Preserve each original sales RPC's permission, location, price, idempotency,
-- and reservation logic. The wrappers add the optional service metadata in
-- the same transaction after the authoritative operation succeeds.
alter function public.create_quote(uuid,uuid,uuid,uuid,jsonb,jsonb) rename to create_quote_base_20260925;
revoke all on function public.create_quote_base_20260925(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.create_quote(p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_quote jsonb; safe_lines jsonb;
begin
  safe_quote:=p_quote-'extra_description';
  safe_lines:=(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_lines) with ordinality x(value,ordinality));
  result:=public.create_quote_base_20260925(p_request_id,p_location_id,p_customer_id,p_customer_vehicle_id,safe_quote,safe_lines);
  update public.quotes set extra_description=nullif(btrim(p_quote->>'extra_description'),'') where id=(result->>'quote_id')::uuid;
  update public.quote_lines q set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_lines) with ordinality e(value,ordinality)
    where q.quote_id=(result->>'quote_id')::uuid and q.line_position=e.ordinality;
  return result;
end; $$;
revoke all on function public.create_quote(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.create_quote(uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;

alter function public.create_walk_in_quote(uuid,uuid,jsonb,jsonb,jsonb) rename to create_walk_in_quote_base_20260925;
revoke all on function public.create_walk_in_quote_base_20260925(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.create_walk_in_quote(p_request_id uuid,p_location_id uuid,p_contact jsonb,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_quote jsonb; safe_lines jsonb;
begin
  safe_quote:=p_quote-'extra_description';
  safe_lines:=(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_lines) with ordinality x(value,ordinality));
  result:=public.create_walk_in_quote_base_20260925(p_request_id,p_location_id,p_contact,safe_quote,safe_lines);
  update public.quotes set extra_description=nullif(btrim(p_quote->>'extra_description'),'') where id=(result->>'quote_id')::uuid;
  update public.quote_lines q set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_lines) with ordinality e(value,ordinality)
    where q.quote_id=(result->>'quote_id')::uuid and q.line_position=e.ordinality;
  return result;
end; $$;
revoke all on function public.create_walk_in_quote(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.create_walk_in_quote(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

alter function public.update_quote_draft(uuid,integer,jsonb,jsonb) rename to update_quote_draft_base_20260925;
revoke all on function public.update_quote_draft_base_20260925(uuid,integer,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.update_quote_draft(p_quote_id uuid,p_expected_version integer,p_quote jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_quote jsonb; safe_lines jsonb;
begin
  safe_quote:=p_quote-'extra_description';
  safe_lines:=(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_lines) with ordinality x(value,ordinality));
  result:=public.update_quote_draft_base_20260925(p_quote_id,p_expected_version,safe_quote,safe_lines);
  update public.quotes set extra_description=nullif(btrim(p_quote->>'extra_description'),'') where id=p_quote_id;
  update public.quote_lines q set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_lines) with ordinality e(value,ordinality)
    where q.quote_id=p_quote_id and q.line_position=e.ordinality;
  return result;
end; $$;
revoke all on function public.update_quote_draft(uuid,integer,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.update_quote_draft(uuid,integer,jsonb,jsonb) to authenticated;

alter function public.create_job(uuid,uuid,uuid,uuid,jsonb,jsonb) rename to create_job_base_20260925;
revoke all on function public.create_job_base_20260925(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.create_job(p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_job jsonb; safe_lines jsonb;
begin
  safe_job:=p_job-'extra_description';
  safe_lines:=(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_lines) with ordinality x(value,ordinality));
  result:=public.create_job_base_20260925(p_request_id,p_location_id,p_customer_id,p_customer_vehicle_id,safe_job,safe_lines);
  update public.jobs set extra_description=nullif(btrim(p_job->>'extra_description'),'') where id=(result->>'job_id')::uuid;
  update public.job_lines j set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_lines) with ordinality e(value,ordinality)
    where j.job_id=(result->>'job_id')::uuid and j.line_position=e.ordinality;
  return result;
end; $$;
revoke all on function public.create_job(uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.create_job(uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;

alter function public.update_job(uuid,integer,jsonb,jsonb) rename to update_job_base_20260925;
revoke all on function public.update_job_base_20260925(uuid,integer,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.update_job(p_job_id uuid,p_expected_version integer,p_job jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_job jsonb; safe_lines jsonb;
begin
  safe_job:=p_job-'extra_description';
  safe_lines:=(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_lines) with ordinality x(value,ordinality));
  result:=public.update_job_base_20260925(p_job_id,p_expected_version,safe_job,safe_lines);
  update public.jobs set extra_description=nullif(btrim(p_job->>'extra_description'),'') where id=p_job_id;
  update public.job_lines j set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_lines) with ordinality e(value,ordinality)
    where j.job_id=p_job_id and j.line_position=e.ordinality and j.is_active;
  return result;
end; $$;
revoke all on function public.update_job(uuid,integer,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.update_job(uuid,integer,jsonb,jsonb) to authenticated;

-- Quote conversion already maps customer_notes (customer-facing) and
-- technician_notes (internal) separately. Carry only customer details and
-- per-line torque into the resulting job.
create or replace function private.copy_quote_service_metadata_to_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source_quote_id is not null then
    update public.jobs j set extra_description=q.extra_description,customer_notes=q.customer_notes
      from public.quotes q where q.id=new.source_quote_id and j.id=new.id;
  end if;
  return new;
end; $$;
revoke all on function private.copy_quote_service_metadata_to_job() from public,anon,authenticated,service_role;
create trigger jobs_copy_quote_service_metadata after insert on public.jobs
for each row execute function private.copy_quote_service_metadata_to_job();

create or replace function private.copy_quote_torque_to_job_line()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.job_lines jl set torque_nm=ql.torque_nm
    from public.jobs j join public.quote_lines ql on ql.quote_id=j.source_quote_id and ql.line_position=new.line_position
    where j.id=new.job_id and jl.id=new.id and j.source_quote_id is not null;
  return new;
end; $$;
revoke all on function private.copy_quote_torque_to_job_line() from public,anon,authenticated,service_role;
create trigger job_lines_copy_quote_torque after insert on public.job_lines
for each row execute function private.copy_quote_torque_to_job_line();

-- Manual invoice RPC wrappers remove the new keys before invoking the existing
-- strict writer, then persist them on the exact draft revision/line positions.
alter function public.create_manual_invoice_v2(uuid,uuid,jsonb) rename to create_manual_invoice_v2_base_20260925;
revoke all on function public.create_manual_invoice_v2_base_20260925(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.create_manual_invoice_v2(p_request_id uuid,p_location_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_input jsonb;
begin
  safe_input:=p_input-'extra_description';
  if jsonb_typeof(p_input->'lines')='array' then
    safe_input:=jsonb_set(safe_input,'{lines}',(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_input->'lines') with ordinality x(value,ordinality)));
  end if;
  result:=public.create_manual_invoice_v2_base_20260925(p_request_id,p_location_id,safe_input);
  update public.invoice_revisions set extra_description=nullif(btrim(p_input->>'extra_description'),'') where id=(result->>'revision_id')::uuid;
  update public.invoice_lines l set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_input->'lines') with ordinality e(value,ordinality)
    where l.revision_id=(result->>'revision_id')::uuid and l.position=e.ordinality;
  return result;
end; $$;
revoke all on function public.create_manual_invoice_v2(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.create_manual_invoice_v2(uuid,uuid,jsonb) to authenticated;

alter function public.update_invoice_draft_v2(uuid,uuid,integer,jsonb) rename to update_invoice_draft_v2_base_20260925;
revoke all on function public.update_invoice_draft_v2_base_20260925(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function public.update_invoice_draft_v2(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; safe_input jsonb; v_revision_id uuid;
begin
  safe_input:=p_input-'extra_description';
  if jsonb_typeof(p_input->'lines')='array' then
    safe_input:=jsonb_set(safe_input,'{lines}',(select coalesce(jsonb_agg(value-'torque_nm' order by ordinality),'[]'::jsonb) from jsonb_array_elements(p_input->'lines') with ordinality x(value,ordinality)));
  end if;
  result:=public.update_invoice_draft_v2_base_20260925(p_request_id,p_invoice_id,p_expected_version,safe_input);
  v_revision_id:=(result->>'revision_id')::uuid;
  if p_input ? 'extra_description' then
    update public.invoice_revisions set extra_description=nullif(btrim(p_input->>'extra_description'),'') where id=v_revision_id;
  end if;
  update public.invoice_lines l set torque_nm=private.sales_torque_value(e.value->'torque_nm')
    from jsonb_array_elements(p_input->'lines') with ordinality e(value,ordinality)
    where l.revision_id=v_revision_id and l.position=e.ordinality;
  return result;
end; $$;
revoke all on function public.update_invoice_draft_v2(uuid,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.update_invoice_draft_v2(uuid,uuid,integer,jsonb) to authenticated;

-- Preserve the existing credit-lock wrapper. The private revision writer
-- receives these values before it freezes the new issued revision.
alter function public.revise_unpaid_invoice(uuid,uuid,integer,jsonb) rename to revise_unpaid_invoice_base_20260925;
revoke all on function public.revise_unpaid_invoice_base_20260925(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function public.revise_unpaid_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return public.revise_unpaid_invoice_base_20260925(p_request_id,p_invoice_id,p_expected_version,p_input);
end; $$;
revoke all on function public.revise_unpaid_invoice(uuid,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.revise_unpaid_invoice(uuid,uuid,integer,jsonb) to authenticated;

-- Job-sourced invoices copy only customer-facing notes and service text.
create or replace function private.copy_job_service_metadata_to_invoice_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.revision_number=1 then
    update public.invoice_revisions r set extra_description=j.extra_description,customer_notes=j.customer_notes
      from public.invoices i join public.jobs j on j.id=i.job_id
      where i.id=new.invoice_id and i.source_type in ('job','pos') and r.id=new.id;
  end if;
  return new;
end; $$;
revoke all on function private.copy_job_service_metadata_to_invoice_revision() from public,anon,authenticated,service_role;
create trigger invoice_revisions_copy_job_service_metadata after insert on public.invoice_revisions
for each row execute function private.copy_job_service_metadata_to_invoice_revision();

-- Carry source torque to job-generated invoice lines and revisions, while a
-- separately entered invoice torque remains possible on manual invoices.
create or replace function private.copy_source_torque_to_invoice_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare rev public.invoice_revisions%rowtype;
begin
  select * into rev from public.invoice_revisions where id=new.revision_id;
  if rev.revision_number>1 then
    update public.invoice_lines il set torque_nm=prev.torque_nm
      from public.invoice_lines prev
      where il.id=new.id and prev.revision_id=(select r.id from public.invoice_revisions r where r.invoice_id=rev.invoice_id and r.revision_number=rev.revision_number-1)
        and prev.position=new.position;
  elsif new.source_job_line_id is not null then
    update public.invoice_lines il set torque_nm=jl.torque_nm
      from public.job_lines jl where il.id=new.id and jl.id=new.source_job_line_id;
  end if;
  return new;
end; $$;
revoke all on function private.copy_source_torque_to_invoice_line() from public,anon,authenticated,service_role;
create trigger invoice_lines_copy_source_torque after insert on public.invoice_lines
for each row execute function private.copy_source_torque_to_invoice_line();

-- Update the guarded revision writer so additional data is set on draft rows
-- before it transitions them to immutable issued history.
create or replace function private.finance_revise_uncredited_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; i public.invoices%rowtype; cur public.invoice_revisions%rowtype; nrid uuid:=extensions.gen_random_uuid();
  nrev integer; reason text; specs jsonb:='[]'::jsonb; existing public.invoice_lines%rowtype; row jsonb; pos integer:=0;
  disc numeric; terms text; snap jsonb; dates jsonb; ctype text; payload jsonb; replay jsonb; result jsonb; doc_number text;
  line_input jsonb; source_position integer;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if i.id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  actor:=private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.edit',i.location_id);
  perform private.finance_guard('invoices.issue',i.location_id);
  perform private.finance_json_keys(p_input,array['revision_reason','payment_terms','customer_reference','customer_notes','extra_description','lines']);
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
    customer_reference,customer_notes,extra_description,source_job_number,source_quote_number,revision_reason,created_by)
  values(nrid,p_invoice_id,nrev,'draft',terms,
    coalesce(nullif(btrim(p_input->>'customer_reference'),''),cur.customer_reference),
    coalesce(nullif(btrim(p_input->>'customer_notes'),''),cur.customer_notes),
    case when p_input ? 'extra_description' then nullif(btrim(p_input->>'extra_description'),'') else cur.extra_description end,
    cur.source_job_number,cur.source_quote_number,reason,actor);
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
      'description',coalesce(nullif(btrim(row->>'description'),''),existing.description),
      'quantity',case when existing.source_job_line_id is not null then existing.quantity::text else coalesce(nullif(row->>'quantity',''),existing.quantity::text) end,
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
  if i.source_type='manual' then perform private.finance_write_v2_lines(p_invoice_id,nrid,specs,i.location_id,actor);
  else perform private.finance_write_revision_lines(p_invoice_id,nrid,specs); end if;
  if jsonb_typeof(p_input->'lines')='array' then
    for line_input in select e.value from pg_catalog.jsonb_array_elements(p_input->'lines') e(value) loop
      if line_input ? 'torque_nm' and nullif(line_input->>'id','') is not null then
        select old_line.position into source_position from public.invoice_lines old_line
          where old_line.revision_id=cur.id and old_line.id=(line_input->>'id')::uuid;
        if source_position is not null then
          update public.invoice_lines new_line set torque_nm=private.sales_torque_value(line_input->'torque_nm')
            where new_line.revision_id=nrid and new_line.position=source_position;
        end if;
      end if;
    end loop;
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
    payment_terms=dates->>'payment_terms',business_snapshot=snap->'business',branch_snapshot=snap->'branch',
    customer_snapshot=snap->'customer',billing_contact_snapshot=snap->'billing_contact',vehicle_snapshot=snap->'vehicle',version=version+1 where id=nrid;
  update public.invoices set current_revision_id=nrid,version=version+1 where id=p_invoice_id;
  select * into cur from public.invoice_revisions where id=nrid;
  doc_number:=i.invoice_number||'-R'||nrev;
  insert into public.financial_documents(invoice_id,location_id,invoice_revision_id,document_type,document_number,source_key,snapshot,template_version)
  values(p_invoice_id,i.location_id,nrid,'tax_invoice',doc_number,'tax_invoice/'||p_invoice_id::text||'/'||nrid::text||'/v1',
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'issue_date',cur.issue_date,'due_date',cur.due_date,
      'revision_reason',reason,'total_incl_gst',cur.total_incl_gst,'gst_amount',cur.gst_amount,'subtotal_ex_gst',cur.subtotal_ex_gst),'v1')
  on conflict (invoice_revision_id,document_type) where document_type='tax_invoice' do nothing;
  result:=pg_catalog.jsonb_build_object('invoice_id',p_invoice_id,'revision_id',nrid,'revision_number',nrev,'version',i.version+1,'issue_date',cur.issue_date,'due_date',cur.due_date);
  perform private.sales_audit('INVOICE_REVISED','invoice',p_invoice_id,i.location_id,
    pg_catalog.jsonb_build_object('invoice_number',i.invoice_number,'revision_number',nrev,'reason',reason,'version_after',i.version+1));
  perform private.finance_request_finish(p_request_id,'revise_unpaid_invoice',payload,i.location_id,p_invoice_id,result);
  return result;
end; $$;
revoke all on function private.finance_revise_uncredited_invoice(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;

-- Enrich immutable financial document snapshots with frozen customer-facing
-- service details and revision lines. Existing documents are never rewritten.
create or replace function private.snapshot_invoice_service_details()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.invoice_revisions%rowtype;
begin
  if new.document_type<>'tax_invoice' then return new; end if;
  select * into r from public.invoice_revisions where id=new.invoice_revision_id;
  new.snapshot:=coalesce(new.snapshot,'{}'::jsonb)||jsonb_build_object(
    'service_details',jsonb_build_object('extra_description',r.extra_description,'notes',r.customer_notes),
    'lines',(select coalesce(jsonb_agg(jsonb_build_object('position',l.position,'description',l.description,'quantity',l.quantity,'torque_nm',l.torque_nm) order by l.position),'[]'::jsonb)
      from public.invoice_lines l where l.revision_id=r.id));
  return new;
end; $$;
revoke all on function private.snapshot_invoice_service_details() from public,anon,authenticated,service_role;
create trigger financial_documents_snapshot_service_details before insert on public.financial_documents
for each row execute function private.snapshot_invoice_service_details();

-- The original invoice_detail permission guard and financial projection remain
-- authoritative; augment its explicit revision projection without exposing
-- internal_notes in document DTOs (the existing field remains internal only).
alter function public.invoice_detail(uuid) rename to invoice_detail_base_20260925;
revoke all on function public.invoice_detail_base_20260925(uuid) from public,anon,authenticated,service_role;
create function public.invoice_detail(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; revisions jsonb;
begin
  result:=public.invoice_detail_base_20260925(p_invoice_id);
  select coalesce(jsonb_agg(x.value||jsonb_build_object('extra_description',r.extra_description,
    'lines',(select coalesce(jsonb_agg(l.value||jsonb_build_object('torque_nm',il.torque_nm) order by il.position),'[]'::jsonb)
      from public.invoice_lines il join lateral (select jsonb_build_object(
        'id',il.id,'position',il.position,'line_type',il.line_type,'description',il.description,'quantity',il.quantity,'product_id',il.product_id,
        'unit_price_incl_gst',il.unit_price_incl_gst,'unit_price_ex_gst',il.unit_price_ex_gst,'pricing_basis',il.pricing_basis,
        'gst_treatment',il.gst_treatment,'discount_type',il.discount_type,'discount_value',il.discount_value,'discount_percent',il.discount_percent,
        'discount_reason',il.discount_reason,'discount_amount',il.discount_amount,'subtotal_ex_gst',il.subtotal_ex_gst,'gst_amount',il.gst_amount,
        'total_incl_gst',il.total_incl_gst,'tyre_details',il.tyre_details,'source_job_line_id',il.source_job_line_id,'used_tyre_unit_id',il.used_tyre_unit_id) as value) l on true
        where il.revision_id=r.id)) order by r.revision_number),'[]'::jsonb) into revisions
  from jsonb_array_elements(coalesce(result->'revisions','[]'::jsonb)) x(value)
  join public.invoice_revisions r on r.id=(x.value->>'id')::uuid;
  return jsonb_set(result,'{revisions}',revisions,true);
end; $$;
revoke all on function public.invoice_detail(uuid) from public,anon,service_role;
grant execute on function public.invoice_detail(uuid) to authenticated;


-- POS keeps its existing single-transaction tender, stock, brand, and scope
-- path; only the validated metadata allowlists are extended.
create or replace function public.finalise_pos_sale(
  p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_customer_vehicle_id uuid,
  p_job_id uuid,p_expected_job_version integer,p_job jsonb,p_lines jsonb,p_tenders jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); existing public.jobs%rowtype; customer public.customers%rowtype;
  payload jsonb; replay jsonb; created jsonb; updated jsonb; completed jsonb; draft jsonb; issued jsonb; payment jsonb;
  create_child uuid:=pg_catalog.md5('finalise_pos_sale:create:'||p_request_id::text)::uuid;
  complete_child uuid:=pg_catalog.md5('finalise_pos_sale:complete:'||p_request_id::text)::uuid;
  jid uuid; job_version integer; iid uuid; total numeric; customer_type text; result jsonb; child uuid;
  chosen_brand text;
begin
  if actor is null or p_request_id is null or p_location_id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  -- Resolved and authorized before any side effect, using the same strict
  -- helper the brand-aware sibling uses. p_brand is always null here: this
  -- entry point has no brand parameter at all, so it can only ever succeed
  -- where exactly one organization is authorized (or fail closed).
  chosen_brand := private.transaction_brand_guard(null, p_location_id);
  if (p_job_id is null)<>(p_expected_job_version is null) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_job is null or pg_catalog.jsonb_typeof(p_job)<>'object' or exists(select 1 from pg_catalog.jsonb_object_keys(p_job) k where k not in ('source_type','walk_in_label','customer_reference','technician_notes','customer_notes','extra_description')) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if coalesce(p_job->>'source_type','pos')<>'pos' then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines)<>'array' or pg_catalog.jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_lines) as line(value) where pg_catalog.jsonb_typeof(line.value)<>'object' or exists(select 1 from pg_catalog.jsonb_object_keys(line.value) as key(name) where key.name not in ('line_type','product_id','used_tyre_unit_id','description','quantity','unit_price_incl_gst','torque_nm'))) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_tenders is null or pg_catalog.jsonb_typeof(p_tenders)<>'array' then raise exception 'INVALID_TENDERS' using errcode='22023'; end if;
  perform private.finance_guard('invoices.view',p_location_id); perform private.finance_guard('invoices.create',p_location_id); perform private.finance_guard('invoices.issue',p_location_id);
  if not private.app_has_permission('pos.use') or not private.app_has_permission('jobs.view') or not private.app_has_permission('jobs.create') or not private.app_has_permission('jobs.edit') or not private.app_has_permission('jobs.complete') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then perform private.finance_guard('payments.view',p_location_id); perform private.finance_guard('payments.record',p_location_id); end if;
  if p_customer_id is null then
    customer_type:='walk_in';
    if nullif(pg_catalog.btrim(p_job->>'walk_in_label'),'') is null then raise exception 'CUSTOMER_REQUIRED' using errcode='22023'; end if;
    if p_customer_vehicle_id is not null then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  else
    select * into customer from public.customers where id=p_customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    customer_type:=customer.customer_type;
  end if;
  payload:=pg_catalog.jsonb_build_object('location_id',p_location_id,'customer_id',p_customer_id,'customer_vehicle_id',p_customer_vehicle_id,'job_id',p_job_id,'expected_job_version',p_expected_job_version,'job',p_job,'lines',p_lines,'tenders',p_tenders);
  replay:=private.finance_request(p_request_id,'finalise_pos_sale',payload); if replay is not null then return replay; end if;
  for child in select x from (values(create_child),(complete_child)) s(x) order by x::text loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||child::text,0)); end loop;
  if p_job_id is null then
    created:=public.create_job(create_child,p_location_id,p_customer_id,p_customer_vehicle_id,p_job||pg_catalog.jsonb_build_object('source_type','pos'),p_lines);
    jid:=(created->>'job_id')::uuid; job_version:=(created->>'version')::integer;
  else
    select * into existing from public.jobs where id=p_job_id for update;
    if not found or existing.location_id<>p_location_id or existing.source_type<>'pos' or existing.customer_id is distinct from p_customer_id or existing.customer_vehicle_id is distinct from p_customer_vehicle_id then raise exception 'POS_JOB_MISMATCH' using errcode='22023'; end if;
    updated:=public.update_job(p_job_id,p_expected_job_version,p_job,p_lines); jid:=p_job_id; job_version:=(updated->>'version')::integer;
  end if;
  completed:=public.complete_job(jid,job_version,complete_child); job_version:=(completed->>'version')::integer;
  draft:=private.finance_build_job_invoice(jid); iid:=(draft->>'invoice_id')::uuid;
  update public.invoices set brand=chosen_brand where id=iid and status='draft';
  if customer_type='business' then update public.invoice_revisions set payment_terms=customer.payment_terms where id=(draft->>'revision_id')::uuid; end if;
  issued:=private.finance_issue_locked(iid,(draft->>'version')::integer);
  select r.total_incl_gst into total from public.invoice_revisions r where r.id=(draft->>'revision_id')::uuid;
  if total=0 and pg_catalog.jsonb_array_length(p_tenders)>0 then raise exception 'ZERO_TOTAL_TENDERS_NOT_ALLOWED' using errcode='22023'; end if;
  if total>0 and customer_type<>'business' and pg_catalog.jsonb_array_length(p_tenders)=0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then payment:=private.finance_record_tenders(pg_catalog.md5('finalise_pos_sale:payment:'||p_request_id::text)::uuid,iid,p_tenders); if customer_type<>'business' and coalesce((payment->>'balance')::numeric,-1)<>0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  else payment:=pg_catalog.jsonb_build_object('payments','[]'::jsonb,'balance',total,'version',(issued->>'version')::integer); end if;
  result:=pg_catalog.jsonb_build_object('job_id',jid,'job_number',coalesce(created->>'job_number',existing.job_number),'job_version',job_version,'invoice_id',iid,'invoice_number',draft->>'invoice_number','invoice_version',coalesce((payment->>'version')::integer,(issued->>'version')::integer),'status','issued','total_incl_gst',total,'payment',payment,'brand',chosen_brand);
  perform private.finance_request_finish(p_request_id,'finalise_pos_sale',payload,p_location_id,iid,result); return result;
end;
$$;

revoke execute on function public.finalise_pos_sale(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb)
  from public,anon,service_role;
grant execute on function public.finalise_pos_sale(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb)
  to authenticated;
revoke execute on function public.finalise_pos_sale_with_brand(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text)
  from public,anon,service_role;
grant execute on function public.finalise_pos_sale_with_brand(uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text)
  to authenticated;

create or replace function public.finalise_pos_sale_with_brand(
  p_request_id uuid, p_location_id uuid, p_customer_id uuid, p_customer_vehicle_id uuid,
  p_job_id uuid, p_expected_job_version integer, p_job jsonb, p_lines jsonb, p_tenders jsonb,
  p_brand text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid:=(select auth.uid()); existing public.jobs%rowtype; customer public.customers%rowtype;
  payload jsonb; replay jsonb; created jsonb; updated jsonb; completed jsonb; draft jsonb; issued jsonb; payment jsonb;
  create_child uuid:=pg_catalog.md5('finalise_pos_sale:create:'||p_request_id::text)::uuid;
  complete_child uuid:=pg_catalog.md5('finalise_pos_sale:complete:'||p_request_id::text)::uuid;
  jid uuid; job_version integer; iid uuid; total numeric; customer_type text; result jsonb; child uuid;
  chosen_brand text;
begin
  if actor is null or p_request_id is null or p_location_id is null then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if (p_job_id is null)<>(p_expected_job_version is null) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_job is null or pg_catalog.jsonb_typeof(p_job)<>'object' or exists(select 1 from pg_catalog.jsonb_object_keys(p_job) k where k not in ('source_type','walk_in_label','customer_reference','technician_notes','customer_notes','extra_description')) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if coalesce(p_job->>'source_type','pos')<>'pos' then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines)<>'array' or pg_catalog.jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'JOB_LINES_REQUIRED' using errcode='22023'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_lines) as line(value) where pg_catalog.jsonb_typeof(line.value)<>'object' or exists(select 1 from pg_catalog.jsonb_object_keys(line.value) as key(name) where key.name not in ('line_type','product_id','used_tyre_unit_id','description','quantity','unit_price_incl_gst','torque_nm'))) then raise exception 'INVALID_POS_INPUT' using errcode='22023'; end if;
  if p_tenders is null or pg_catalog.jsonb_typeof(p_tenders)<>'array' then raise exception 'INVALID_TENDERS' using errcode='22023'; end if;
  perform private.finance_guard('invoices.view',p_location_id); perform private.finance_guard('invoices.create',p_location_id); perform private.finance_guard('invoices.issue',p_location_id);
  if not private.app_has_permission('pos.use') or not private.app_has_permission('jobs.view') or not private.app_has_permission('jobs.create') or not private.app_has_permission('jobs.edit') or not private.app_has_permission('jobs.complete') then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then perform private.finance_guard('payments.view',p_location_id); perform private.finance_guard('payments.record',p_location_id); end if;
  -- Business identity is resolved and authorized up front, before any job or
  -- invoice row is touched, using the STRICT POS guard: no location-code
  -- fallback, ever - not even at LON.
  chosen_brand := private.transaction_brand_guard(p_brand, p_location_id);
  if p_customer_id is null then
    customer_type:='walk_in';
    if nullif(pg_catalog.btrim(p_job->>'walk_in_label'),'') is null then raise exception 'CUSTOMER_REQUIRED' using errcode='22023'; end if;
    if p_customer_vehicle_id is not null then raise exception 'VEHICLE_CUSTOMER_MISMATCH' using errcode='22023'; end if;
  else
    select * into customer from public.customers where id=p_customer_id and active;
    if not found then raise exception 'CUSTOMER_ARCHIVED' using errcode='22023'; end if;
    customer_type:=customer.customer_type;
  end if;
  payload:=pg_catalog.jsonb_build_object('location_id',p_location_id,'customer_id',p_customer_id,'customer_vehicle_id',p_customer_vehicle_id,'job_id',p_job_id,'expected_job_version',p_expected_job_version,'job',p_job,'lines',p_lines,'tenders',p_tenders,'brand',chosen_brand);
  replay:=private.finance_request(p_request_id,'finalise_pos_sale_with_brand',payload); if replay is not null then return replay; end if;
  for child in select x from (values(create_child),(complete_child)) s(x) order by x::text loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||child::text,0)); end loop;
  if p_job_id is null then
    created:=public.create_job(create_child,p_location_id,p_customer_id,p_customer_vehicle_id,p_job||pg_catalog.jsonb_build_object('source_type','pos'),p_lines);
    jid:=(created->>'job_id')::uuid; job_version:=(created->>'version')::integer;
  else
    select * into existing from public.jobs where id=p_job_id for update;
    if not found or existing.location_id<>p_location_id or existing.source_type<>'pos' or existing.customer_id is distinct from p_customer_id or existing.customer_vehicle_id is distinct from p_customer_vehicle_id then raise exception 'POS_JOB_MISMATCH' using errcode='22023'; end if;
    updated:=public.update_job(p_job_id,p_expected_job_version,p_job,p_lines); jid:=p_job_id; job_version:=(updated->>'version')::integer;
  end if;
  completed:=public.complete_job(jid,job_version,complete_child); job_version:=(completed->>'version')::integer;
  draft:=private.finance_build_job_invoice(jid); iid:=(draft->>'invoice_id')::uuid;
  update public.invoices set brand=chosen_brand where id=iid and status='draft';
  if customer_type='business' then update public.invoice_revisions set payment_terms=customer.payment_terms where id=(draft->>'revision_id')::uuid; end if;
  issued:=private.finance_issue_locked(iid,(draft->>'version')::integer);
  select r.total_incl_gst into total from public.invoice_revisions r where r.id=(draft->>'revision_id')::uuid;
  if total=0 and pg_catalog.jsonb_array_length(p_tenders)>0 then raise exception 'ZERO_TOTAL_TENDERS_NOT_ALLOWED' using errcode='22023'; end if;
  if total>0 and customer_type<>'business' and pg_catalog.jsonb_array_length(p_tenders)=0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  if pg_catalog.jsonb_array_length(p_tenders)>0 then payment:=private.finance_record_tenders(pg_catalog.md5('finalise_pos_sale:payment:'||p_request_id::text)::uuid,iid,p_tenders); if customer_type<>'business' and coalesce((payment->>'balance')::numeric,-1)<>0 then raise exception 'POS_FULL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  else payment:=pg_catalog.jsonb_build_object('payments','[]'::jsonb,'balance',total,'version',(issued->>'version')::integer); end if;
  result:=pg_catalog.jsonb_build_object('job_id',jid,'job_number',coalesce(created->>'job_number',existing.job_number),'job_version',job_version,'invoice_id',iid,'invoice_number',draft->>'invoice_number','invoice_version',coalesce((payment->>'version')::integer,(issued->>'version')::integer),'status','issued','total_incl_gst',total,'payment',payment,'brand',chosen_brand);
  perform private.finance_request_finish(p_request_id,'finalise_pos_sale_with_brand',payload,p_location_id,iid,result); return result;
end;
$$;
