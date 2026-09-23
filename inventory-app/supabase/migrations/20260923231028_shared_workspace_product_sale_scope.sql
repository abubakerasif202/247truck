-- Workspace ownership is the physical inventory location. A location may
-- authorize more than one business; no arbitrary organization can be inferred
-- from its assignments. The sale still checks that the chosen organization is
-- authorized at the selling location before reaching this helper.
create or replace function private.assert_product_organization_scope(
  p_product public.products, p_organization_id uuid, p_location_id uuid
)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_product.owner_location_id is null then return; end if;
  if p_product.owner_location_id is distinct from p_location_id
    or not exists (
      select 1 from public.organization_location_assignments ola
      where ola.organization_id = p_organization_id
        and ola.location_id = p_location_id and ola.active
    ) then
    raise exception 'PRODUCT_NOT_AVAILABLE_AT_LOCATION' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function private.assert_product_organization_scope(public.products,uuid,uuid)
  from public, anon, authenticated, service_role;

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
    perform private.assert_product_organization_scope(v_product, p_organization_id, p_location_id);
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

-- The ambiguous two-argument helper has no remaining callers.
drop function private.assert_product_organization_scope(public.products,uuid);
