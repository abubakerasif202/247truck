-- Once an issued credit note exists, the invoice's issued line set is part of
-- immutable financial history. Serialize revision/void attempts with credit
-- creation on the invoice row and require cancellation to use cancel_invoice,
-- which credits only the remaining value and preserves refund liabilities.

alter function public.revise_unpaid_invoice(uuid,uuid,integer,jsonb) set schema private;
alter function private.revise_unpaid_invoice(uuid,uuid,integer,jsonb) rename to finance_revise_uncredited_invoice;
revoke execute on function private.finance_revise_uncredited_invoice(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;

create or replace function public.revise_unpaid_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.edit',i.location_id);
  perform private.finance_guard('invoices.issue',i.location_id);

  select * into i from public.invoices where id=p_invoice_id for update;
  if exists (
    select 1 from public.credit_notes c
    where c.invoice_id=i.id and c.status='issued'
  ) then
    raise exception 'INVOICE_CREDIT_LOCKED' using errcode='42501';
  end if;

  return private.finance_revise_uncredited_invoice(p_request_id,p_invoice_id,p_expected_version,p_input);
end; $$;
revoke execute on function public.revise_unpaid_invoice(uuid,uuid,integer,jsonb) from public,anon,service_role;
grant execute on function public.revise_unpaid_invoice(uuid,uuid,integer,jsonb) to authenticated;

-- Direct revision writes and current-revision pointer changes receive the same
-- database invariant as the RPC. The invoice row lock shares the lock order
-- used by credit-note creation and by the public wrapper above.
create or replace function private.finance_revision_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid; locked_at timestamptz; has_credit boolean;
begin
  if tg_op<>'INSERT' and old.lifecycle='issued' then raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  target:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select i.first_payment_at,exists(select 1 from public.credit_notes c where c.invoice_id=i.id and c.status='issued')
    into locked_at,has_credit from public.invoices i where i.id=target for update;
  if locked_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
  if has_credit then raise exception 'INVOICE_CREDIT_LOCKED' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.id,new.invoice_id,new.revision_number) is distinct from (old.id,old.invoice_id,old.revision_number) then
    raise exception 'FINANCE_HISTORY_IMMUTABLE' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;

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
    if new.current_revision_id is distinct from old.current_revision_id then
      if old.first_payment_at is not null then raise exception 'INVOICE_FINANCIAL_LOCKED' using errcode='42501'; end if;
      if exists(select 1 from public.credit_notes c where c.invoice_id=old.id and c.status='issued') then
        raise exception 'INVOICE_CREDIT_LOCKED' using errcode='42501';
      end if;
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
end; $$;

-- The legacy void path is only valid for a wholly uncredited, unpaid invoice.
-- Credited invoices remain cancellable through cancel_invoice, including its
-- existing pending-refund and final-cancellation workflow.
alter function public.void_issued_invoice(uuid,uuid,integer,text) set schema private;
alter function private.void_issued_invoice(uuid,uuid,integer,text) rename to finance_void_uncredited_invoice;
revoke execute on function private.finance_void_uncredited_invoice(uuid,uuid,integer,text) from public,anon,authenticated,service_role;

create or replace function public.void_issued_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.cancel',i.location_id);
  select * into i from public.invoices where id=p_invoice_id for update;
  if exists(select 1 from public.credit_notes c where c.invoice_id=i.id and c.status='issued') then
    raise exception 'INVOICE_CREDIT_LOCKED' using errcode='42501';
  end if;
  return private.finance_void_uncredited_invoice(p_request_id,p_invoice_id,p_expected_version,p_reason);
end; $$;
revoke execute on function public.void_issued_invoice(uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function public.void_issued_invoice(uuid,uuid,integer,text) to authenticated;

-- Recheck cancellation replay after taking the invoice lock. Two identical
-- requests can both miss the optimistic pre-lock lookup; the waiter must see
-- the request saved by the winner instead of failing a version check.
alter function public.cancel_invoice(uuid,uuid,integer,text) set schema private;
alter function private.cancel_invoice(uuid,uuid,integer,text) rename to finance_cancel_invoice_serialized;
revoke execute on function private.finance_cancel_invoice_serialized(uuid,uuid,integer,text) from public,anon,authenticated,service_role;

create or replace function public.cancel_invoice(p_request_id uuid,p_invoice_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.invoices%rowtype; payload jsonb; replay jsonb;
begin
  select * into i from public.invoices where id=p_invoice_id;
  if not found then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform private.finance_guard('invoices.view',i.location_id);
  perform private.finance_guard('invoices.cancel',i.location_id);
  if nullif(btrim(p_reason),'') is null or length(p_reason)>500 then
    raise exception 'CANCELLATION_REASON_REQUIRED' using errcode='22023';
  end if;
  payload:=jsonb_build_object('invoice_id',p_invoice_id,'expected_version',p_expected_version,'reason',btrim(p_reason));
  replay:=private.finance_cancel_legacy_replay(p_request_id,'cancel_invoice',payload);
  if replay is not null then return replay; end if;
  replay:=private.finance_request(p_request_id,'cancel_invoice',payload);
  if replay is not null then return replay; end if;

  select * into i from public.invoices where id=p_invoice_id for update;
  replay:=private.finance_cancel_legacy_replay(p_request_id,'cancel_invoice',payload);
  if replay is not null then return replay; end if;
  replay:=private.finance_request(p_request_id,'cancel_invoice',payload);
  if replay is not null then return replay; end if;
  return private.finance_cancel_invoice_serialized(p_request_id,p_invoice_id,p_expected_version,p_reason);
end; $$;
revoke execute on function public.cancel_invoice(uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function public.cancel_invoice(uuid,uuid,integer,text) to authenticated;
