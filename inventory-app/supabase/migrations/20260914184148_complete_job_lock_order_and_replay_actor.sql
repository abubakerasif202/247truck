-- Two hardening fixes to public.complete_job:
--
-- 1. Lock-order mismatch: private.reserve_job_lines takes its per-product
--    inventory_balances row locks in `order by product_id, id`, but
--    complete_job iterated `order by line_position`. Two jobs holding the
--    same two products in opposite line order can deadlock against each
--    other on the balance locks. Match reserve_job_lines' order so the same
--    stable lock order is used everywhere a job touches balances.
--
-- 2. The idempotency replay lookup did not check actor_user_id, unlike every
--    other request_id-keyed RPC in this ledger (create_job, finance_request).
--    A caller who learns another user's complete_job request_id (an
--    unguessable v4 UUID, so low practical impact) could replay it and read
--    back that job's id/version. Check the acting user, matching the
--    pattern used elsewhere.

create or replace function public.complete_job(p_job_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); j public.jobs%rowtype; l public.job_lines%rowtype; r public.inventory_reservations%rowtype; u public.used_tyre_units%rowtype; m record; result jsonb; prior_result jsonb; movement_request uuid; captured_cost numeric;
begin
  if p_request_id is null or not (select private.sales_permission('jobs.complete')) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sales-request:'||p_request_id::text,0));
  select car.result into prior_result from public.commercial_action_requests car where car.request_id=p_request_id and car.action='complete_job' and car.actor_user_id=actor; if prior_result is not null then return prior_result; end if;
  if exists(select 1 from public.commercial_action_requests where request_id=p_request_id) then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505'; end if;
  select * into j from public.jobs where id=p_job_id and (select private.sales_location_allowed(location_id)) for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode='P0002'; end if;
  if j.status='completed' then raise exception 'JOB_ALREADY_COMPLETED' using errcode='22023'; end if;
  if j.version<>p_expected_version then raise exception 'JOB_VERSION_CONFLICT' using errcode='40001'; end if;
  if not j.pricing_complete then raise exception 'PRICE_PENDING' using errcode='22023'; end if;
  for l in select * from public.job_lines where job_id=j.id and is_active and line_type='product' order by product_id,line_position loop
    select * into r from public.inventory_reservations where job_line_id=l.id and status='active' for update;
    if not found or r.quantity<>l.quantity::integer or r.location_id<>j.location_id then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    if r.used_tyre_unit_id is distinct from l.used_tyre_unit_id then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    if r.used_tyre_unit_id is not null then
      select * into u from public.used_tyre_units where id=r.used_tyre_unit_id for update;
      if not found or u.status<>'reserved' or u.product_id<>l.product_id or u.location_id<>j.location_id then raise exception 'USED_TYRE_NOT_AVAILABLE' using errcode='23514'; end if;
      captured_cost:=u.cost_basis;
    end if;
    movement_request:=replace(md5(p_request_id::text||':'||l.line_position::text),' ','')::uuid;
    update public.inventory_balances set reserved=reserved-r.quantity,updated_at=now() where product_id=r.product_id and location_id=r.location_id and reserved>=r.quantity;
    if not found then raise exception 'RESERVATION_INCONSISTENT' using errcode='23514'; end if;
    select * into m from public.post_inventory_movement(movement_request,l.product_id,j.location_id,-l.quantity::integer,case when r.used_tyre_unit_id is null then 'stock_out' else 'used_unit_out' end,'Workshop job '||j.job_number,null,r.used_tyre_unit_id,'job',j.id::text,null);
    if r.used_tyre_unit_id is null then select weighted_average_cost into captured_cost from public.inventory_balances where product_id=l.product_id and location_id=j.location_id; end if;
    if r.used_tyre_unit_id is not null then update public.used_tyre_units set status='sold',updated_at=now() where id=r.used_tyre_unit_id; end if;
    update public.job_lines set inventory_movement_id=m.movement_id,cost_basis=captured_cost where id=l.id;
    update public.inventory_reservations set status='consumed' where id=r.id;
  end loop;
  update public.jobs set status='completed',completed_at=now(),version=version+1 where id=j.id;
  result:=jsonb_build_object('job_id',j.id,'status','completed','version',j.version+1);
  insert into public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result) values(p_request_id,'complete_job',actor,j.id,'complete:'||j.id::text,result);
  perform private.sales_audit('JOB_COMPLETED','job',j.id,j.location_id,jsonb_build_object('job_number',j.job_number,'version_before',j.version,'version_after',j.version+1));
  return result;
end;
$$;
