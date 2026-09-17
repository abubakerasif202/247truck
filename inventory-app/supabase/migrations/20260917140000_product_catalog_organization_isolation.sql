-- Product / organization isolation for the shared product catalogue.
--
-- Schema invariant this migration establishes and documents:
--
--   public.products is a shared reference catalogue (SKU / tyre definition).
--   A row existing in it does NOT by itself authorize anyone to sell it
--   anywhere. Organization ownership of *stock* begins one layer down, at
--   public.inventory_balances, which is keyed by (product_id, location_id),
--   and each active location belongs to exactly one organization via the
--   partial-unique-indexed public.organization_location_assignments. The
--   same catalogue product may legitimately carry inventory at locations
--   belonging to different organizations at once (see 20260915191609,
--   which pre-seeds inventory_balances for every location for a
--   shared/global product).
--
--   The one column that DOES carry organization affinity on products itself
--   is owner_location_id (added in 20260915191609_flexible_product_creation):
--     - NULL      -> shared/global catalogue entry (all 55 pre-existing
--                    production products, and any future intentionally
--                    shared entry). No ownership constraint applies; safety
--                    for these rests entirely on the location-scoped balance
--                    check below, exactly as it already did.
--     - not null  -> a workspace-owned product created through
--                    public.create_workspace_product, exclusive to the
--                    organization that owns that location. products_read RLS
--                    already hides these from a foreign location's direct
--                    SELECT, but private.commit_sale is SECURITY DEFINER and
--                    therefore bypasses RLS entirely, so it must re-assert
--                    this boundary itself before selling.
--
-- Nothing here backfills or guesses owner_location_id for existing rows.
-- private.product_sale_price(product_id, tier) remains an intentionally
-- global, per-product price (see 20260914120000): it takes no
-- organization/location argument and reads products.retail_price_incl_gst /
-- wholesale_price_incl_gst directly. That is existing, evidenced behavior,
-- not something invented here.

create or replace function private.assert_product_organization_scope(
  p_product public.products,
  p_organization_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner_organization_id uuid;
begin
  -- Shared/global catalogue entry: no single organization owns it. Safety
  -- for this case is enforced by the caller's own inventory_balances lookup
  -- at the exact selling location, not here.
  if p_product.owner_location_id is null then
    return;
  end if;

  select ola.organization_id into v_owner_organization_id
  from public.organization_location_assignments ola
  where ola.location_id = p_product.owner_location_id and ola.active;

  if v_owner_organization_id is null or v_owner_organization_id <> p_organization_id then
    raise exception 'PRODUCT_NOT_AVAILABLE_AT_LOCATION' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.assert_product_organization_scope(public.products, uuid)
  from public, anon, authenticated, service_role;

-- Re-create private.commit_sale with the single added authorization line
-- (perform private.assert_product_organization_scope(...) immediately after
-- the product lookup, before any balance read/lock or side effect). Every
-- other line is unchanged from 20260916204935_generic_sales_webhook_organization_foundation.sql.
create or replace function private.commit_sale(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_source text,
  p_order_namespace text,
  p_external_order_id text,
  p_items jsonb,
  p_expected_total numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_balance public.inventory_balances%rowtype;
  v_product_id uuid;
  v_quantity integer;
  v_unit_price numeric(14,2);
  v_tax_amount numeric(14,2);
  v_line_total numeric(14,2);
  v_movement_id uuid;
  v_line_position integer := 0;
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_payload_hash text;
  v_movement_request_id uuid;
  v_existing_item_count integer;
begin
  if p_request_id is null or p_actor_user_id is null
     or p_source not in ('internal', 'website', 'stripe')
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;
  if (p_external_order_id is null) <> (p_order_namespace is null) then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;
  if p_external_order_id is not null and btrim(p_external_order_id) = '' then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;

  v_role := private.assert_sale_actor(p_actor_user_id, p_location_id);
  perform private.assert_organization_location_scope(p_organization_id, p_location_id);
  v_payload_hash := encode(extensions.digest(convert_to(p_items::text, 'UTF8'), 'sha256'), 'hex');

  -- The two locks make retries and distinct webhook deliveries for the same
  -- external order serialize before either can consume inventory. The order
  -- lock is keyed by namespace, not by source, so two channel aliases that
  -- legitimately share a namespace also serialize against each other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'generic-sale-request:' || p_actor_user_id::text || ':' || p_location_id::text || ':' || p_request_id::text, 0));
  if p_external_order_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'generic-sale-order:' || p_organization_id::text || ':' || p_order_namespace || ':' || btrim(p_external_order_id), 0));
  end if;

  select * into v_sale from public.sales
  where actor_user_id = p_actor_user_id and location_id = p_location_id and request_id = p_request_id
  for update;
  if found then
    if v_sale.organization_id <> p_organization_id or v_sale.source <> p_source
       or v_sale.external_order_id is distinct from nullif(btrim(p_external_order_id), '')
       or v_sale.order_namespace is distinct from p_order_namespace
       or v_sale.payload_hash <> v_payload_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object('sale_id', v_sale.id, 'status', v_sale.status, 'replayed', true,
      'total_incl_gst', v_sale.total_incl_gst);
  end if;

  if p_external_order_id is not null then
    select * into v_sale from public.sales
    where organization_id = p_organization_id and order_namespace = p_order_namespace
      and external_order_id = nullif(btrim(p_external_order_id), '')
    for update;
    if found then
      if v_sale.payload_hash <> v_payload_hash or v_sale.location_id <> p_location_id then
        raise exception 'EXTERNAL_ORDER_REUSED' using errcode = '22023';
      end if;
      return jsonb_build_object('sale_id', v_sale.id, 'status', v_sale.status, 'replayed', true,
        'total_incl_gst', v_sale.total_incl_gst);
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) as x(item)
    where jsonb_typeof(x.item) <> 'object'
      or coalesce(x.item->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(x.item->>'quantity', '') !~ '^[1-9][0-9]*$'
      or x.item ? 'unit_price_incl_gst'
  ) then
    raise exception 'INVALID_SALE_ITEM' using errcode = '22023';
  end if;
  select count(*), count(distinct (item->>'product_id')::uuid)
  into v_existing_item_count, v_line_position
  from jsonb_array_elements(p_items) as x(item);
  if v_existing_item_count <> v_line_position then
    raise exception 'DUPLICATE_SALE_PRODUCT' using errcode = '22023';
  end if;
  v_line_position := 0;

  insert into public.sales(
    organization_id, location_id, request_id, actor_user_id, source,
    order_namespace, external_order_id, payload_hash, status
  ) values (
    p_organization_id, p_location_id, p_request_id, p_actor_user_id, p_source,
    p_order_namespace, nullif(btrim(p_external_order_id), ''), v_payload_hash, 'committing'
  ) returning * into v_sale;

  for v_item in
    select item from jsonb_array_elements(p_items) as x(item)
    order by (item->>'product_id')::uuid
  loop
    v_line_position := v_line_position + 1;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id = v_product_id and active;
    if not found then
      raise exception 'SALE_PRODUCT_NOT_FOUND' using errcode = 'P0002';
    end if;
    -- A global Product ID is not itself authorization to sell it. If this
    -- product carries an explicit workspace owner (owner_location_id is not
    -- null), that owner's organization must match the selling organization.
    -- Shared/global catalogue rows (owner_location_id null) fall through
    -- unconstrained here; they are still bound to the exact selling location
    -- by the inventory_balances lookup immediately below.
    perform private.assert_product_organization_scope(v_product, p_organization_id);
    select * into v_balance from public.inventory_balances
    where product_id = v_product_id and location_id = p_location_id for update;
    if not found then
      raise exception 'BALANCE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_balance.on_hand - v_balance.reserved < v_quantity then
      raise exception 'INSUFFICIENT_STOCK' using errcode = '23514';
    end if;
    -- Price authority is server-side only: the caller (staff terminal or
    -- trusted webhook) can never assert a unit price. It is always derived
    -- from the product's own retail price record.
    v_unit_price := private.product_sale_price(v_product_id, 'retail');
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'SALE_PRICE_REQUIRED' using errcode = '22023';
    end if;
    -- Line-rounded GST, matching the existing finance calculation
    -- (round(line_total / 11, 2)) rather than rounding a per-unit tax and
    -- multiplying, which can disagree on multi-quantity decimal prices.
    v_line_total := round((v_unit_price * v_quantity)::numeric, 2);
    v_tax_amount := round((v_line_total / 11)::numeric, 2);
    v_movement_request_id := (md5(p_request_id::text || ':' || v_product_id::text))::uuid;

    update public.inventory_balances
    set on_hand = on_hand - v_quantity, updated_at = now()
    where product_id = v_product_id and location_id = p_location_id;
    insert into public.inventory_movements(
      request_id, product_id, location_id, quantity_delta, movement_type,
      reason, source_type, source_id, cost_snapshot, actor_user_id
    ) values (
      v_movement_request_id, v_product_id, p_location_id, -v_quantity, 'stock_out',
      'Generic sale', 'generic_sale', v_sale.id::text, v_balance.weighted_average_cost, p_actor_user_id
    ) returning id into v_movement_id;
    insert into public.sale_items(
      sale_id, line_position, product_id, inventory_movement_id, sku_snapshot,
      name_snapshot, description_snapshot, quantity, unit_price_incl_gst,
      tax_amount, unit_cost_snapshot, line_total_incl_gst
    ) values (
      v_sale.id, v_line_position, v_product_id, v_movement_id, v_product.part_reference,
      v_product.name, v_product.name, v_quantity, v_unit_price, v_tax_amount,
      v_balance.weighted_average_cost, v_line_total
    );
    v_subtotal := v_subtotal + v_line_total;
    v_tax_total := v_tax_total + v_tax_amount;
  end loop;

  -- A trusted payment source can supply the amount it actually collected.
  -- Reject the whole sale rather than silently trusting either figure.
  if p_expected_total is not null and p_expected_total <> v_subtotal then
    raise exception 'PAYMENT_AMOUNT_MISMATCH' using errcode = '22023';
  end if;

  update public.sales
  set status = 'committed', subtotal_incl_gst = v_subtotal, tax_amount = v_tax_total,
      total_incl_gst = v_subtotal, committed_at = now(), updated_at = now()
  where id = v_sale.id;
  insert into public.audit_events(actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details)
  values (p_actor_user_id, v_role, p_location_id, 'GENERIC_SALE_COMMITTED', 'sale', v_sale.id::text,
    jsonb_build_object('organization_id', p_organization_id, 'source', p_source,
      'external_order_id', nullif(btrim(p_external_order_id), ''), 'line_count', v_line_position,
      'total_incl_gst', v_subtotal));
  return jsonb_build_object('sale_id', v_sale.id, 'status', 'committed', 'replayed', false,
    'total_incl_gst', v_subtotal);
end;
$$;

revoke execute on function private.commit_sale(uuid, uuid, uuid, uuid, text, text, text, jsonb, numeric)
  from public, anon, authenticated, service_role;

-- Independent correctness fix, discovered while proving the isolation fix
-- above: 20260915191609_flexible_product_creation.sql made
-- private.seed_inventory_balances seed a balance row only at a workspace
-- product's own owner_location_id (or everywhere, for a shared product),
-- instead of unconditionally at every location as
-- 20260902092000_inventory_ledger.sql originally did. public.receive_transfer
-- was never updated for that: its destination-side
-- `update public.inventory_balances ... where product_id=... and
-- location_id=...` silently affects zero rows when no balance row exists yet
-- at the destination, while the transfer_in inventory_movements row is still
-- inserted unconditionally. The stock is debited at the source, recorded as
-- arrived by the movement ledger, and then never credited at the destination
-- - a silent stock loss for exactly the case this migration adds test
-- coverage for (a workspace-owned product transferred to a location that
-- never had a seeded balance row). Fixed by ensuring the destination balance
-- row exists (zero-initialized, matching the original seeding default)
-- before crediting it. Every other line is unchanged from the current,
-- idempotency-fingerprinted version of this function in
-- 20260912131000_transfer_replay_hardening.sql (NOT the earlier
-- 20260905100000_stock_transfers.sql body).
create or replace function public.receive_transfer(p_transfer_id uuid, p_request_id uuid, p_receipts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.stock_transfers%rowtype;
  l record;
  qty integer;
  b public.inventory_balances%rowtype;
  wac numeric(14,4);
  existing_action public.stock_transfer_actions%rowtype;
  canonical_receipts jsonb;
  fingerprint jsonb;
  result jsonb;
begin
  if p_transfer_id is null or p_request_id is null or (select auth.uid()) is null then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' then
    raise exception 'INVALID_RECEIPT_LINES' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_receipts) r
    where jsonb_typeof(r) <> 'object'
      or not (r ? 'product_id' and r ? 'received_quantity')
      or jsonb_typeof(r->'product_id') <> 'string'
      or jsonb_typeof(r->'received_quantity') <> 'number'
      or (r->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (r->>'received_quantity') !~ '^[0-9]+$'
      or (select count(*) from jsonb_object_keys(r)) <> 2
  ) then
    raise exception 'INVALID_RECEIPT_LINES' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_receipts) r
    group by (r->>'product_id')::uuid having count(*) > 1
  ) then
    raise exception 'DUPLICATE_RECEIPT_LINE' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer-request:'||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer:'||p_transfer_id::text,0));
  select * into v from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='P0002'; end if;
  if not (select private.transfer_operator_authorized(v.destination_location_id)) then
    raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_receipts) r
    left join public.stock_transfer_lines line
      on line.transfer_id=p_transfer_id and line.product_id=(r->>'product_id')::uuid
    where line.id is null
  ) or jsonb_array_length(p_receipts) <> (select count(*) from public.stock_transfer_lines where transfer_id=p_transfer_id) then
    raise exception 'UNKNOWN_OR_MISSING_RECEIPT_LINE' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', (r->>'product_id')::uuid,
    'received_quantity', (r->>'received_quantity')::integer
  ) order by (r->>'product_id')::uuid), '[]'::jsonb)
  into canonical_receipts from jsonb_array_elements(p_receipts) r;
  fingerprint := jsonb_build_object('action','receive','transfer_id',p_transfer_id,'receipts',canonical_receipts);

  select * into existing_action from public.stock_transfer_actions where request_id=p_request_id;
  if found then
    if existing_action.actor_user_id <> (select auth.uid())
      or existing_action.action <> 'receive'
      or existing_action.transfer_id <> p_transfer_id
    then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023'; end if;
    if existing_action.request_fingerprint is null then
      raise exception 'IDEMPOTENCY_RECONCILIATION_REQUIRED' using errcode='55000';
    end if;
    if existing_action.request_fingerprint <> fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='22023';
    end if;
    return existing_action.result;
  end if;

  if v.status <> 'in_transit' then raise exception 'INVALID_TRANSFER_TRANSITION' using errcode='22023'; end if;
  -- Ensure every product on this transfer already has a (possibly
  -- zero-initialized) balance row at the destination before locking rows for
  -- update, so a workspace-owned product entering a location it has never
  -- held stock at gets one instead of silently losing the credited quantity.
  insert into public.inventory_balances(product_id, location_id)
  select line.product_id, v.destination_location_id
  from public.stock_transfer_lines line
  where line.transfer_id = p_transfer_id
  order by line.product_id
  on conflict (product_id, location_id) do nothing;
  perform 1
  from public.inventory_balances balance
  join public.stock_transfer_lines line on line.product_id=balance.product_id and line.transfer_id=p_transfer_id
  where balance.location_id=v.destination_location_id
  order by balance.product_id
  for update of balance;
  for l in select * from public.stock_transfer_lines where transfer_id=p_transfer_id order by product_id loop
    select (r->>'received_quantity')::integer into qty from jsonb_array_elements(canonical_receipts) r where (r->>'product_id')::uuid=l.product_id;
    if qty < 0 or qty > l.dispatched_quantity then raise exception 'OVER_RECEIPT' using errcode='22023'; end if;
    if qty > 0 then
      select * into b from public.inventory_balances where product_id=l.product_id and location_id=v.destination_location_id for update;
      wac := case when l.transfer_cost_snapshot is null or b.weighted_average_cost is null and b.on_hand > 0 then null
        when b.on_hand=0 then l.transfer_cost_snapshot
        else ((b.on_hand*b.weighted_average_cost)+(qty*l.transfer_cost_snapshot))/(b.on_hand+qty) end;
      insert into public.inventory_movements(request_id,product_id,location_id,quantity_delta,movement_type,reason,source_type,source_id,inbound_unit_cost,cost_snapshot,actor_user_id,transfer_id,transfer_line_id)
      values(p_request_id,l.product_id,v.destination_location_id,qty,'transfer_in','Branch stock transfer','stock_transfer',p_transfer_id::text,l.transfer_cost_snapshot,wac,auth.uid(),p_transfer_id,l.id);
      update public.inventory_balances set on_hand=on_hand+qty, weighted_average_cost=wac, updated_at=now() where product_id=l.product_id and location_id=v.destination_location_id;
    end if;
    update public.stock_transfer_lines set received_quantity=qty where id=l.id;
  end loop;
  if exists(select 1 from public.stock_transfer_lines where transfer_id=p_transfer_id and received_quantity <> dispatched_quantity) then
    update public.stock_transfers set status='review_required', discrepancy_notes='Received quantity differs from dispatched quantity', received_by=auth.uid(), received_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
    perform private.transfer_audit(p_transfer_id,'TRANSFER_RECEIVED','in_transit','review_required',jsonb_build_object('request_id',p_request_id));
    perform private.transfer_audit(p_transfer_id,'TRANSFER_DISCREPANCY_RECORDED','in_transit','review_required',jsonb_build_object('request_id',p_request_id));
  else
    update public.stock_transfers set status='completed', received_by=auth.uid(), received_at=now(), completed_at=now(), updated_at=now(), version=version+1 where id=p_transfer_id;
    perform private.transfer_audit(p_transfer_id,'TRANSFER_RECEIVED','in_transit','completed',jsonb_build_object('request_id',p_request_id));
    perform private.transfer_audit(p_transfer_id,'TRANSFER_COMPLETED','in_transit','completed');
  end if;
  result := jsonb_build_object('transfer_id',p_transfer_id,'request_id',p_request_id,'status',(select status from public.stock_transfers where id=p_transfer_id));
  insert into public.stock_transfer_actions(request_id,transfer_id,action,actor_user_id,request_fingerprint,result)
  values(p_request_id,p_transfer_id,'receive',auth.uid(),fingerprint,result);
  return result;
end;
$$;

revoke execute on function public.receive_transfer(uuid,uuid,jsonb) from public, anon, service_role;
grant execute on function public.receive_transfer(uuid,uuid,jsonb) to authenticated;
