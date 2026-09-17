-- Shared-location multi-organization sales.
--
-- Business reality, confirmed authoritatively (not inferred from naming):
-- 24/7 Truck Tyre Services and Adelaide Wholesale Tyres both operate from the
-- same physical address (6 Birralee Rd, Regency Park SA 5010) and both
-- already draw down the SAME `inventory_balances`/`inventory_movements`
-- ledger rows at that one location (`REG`): the AWT website integration
-- writes there via AWT_INVENTORY_LOCATION_ID (see
-- docs/inventory-production-runbook.md, "approved Regency inventory location
-- UUID"), and 24/7's own POS/opening-stock history is 100% at REG too. `LON`
-- has never held real stock (zero inventory_movements rows, all-zero
-- balances) and is untouched by this migration - see its own migration
-- comment in 20260915101500_manual_opening_stock_and_awt_location_name.sql:
-- "Legacy LON location code retained for historical FK/data compatibility."
--
-- 20260916204935_generic_sales_webhook_organization_foundation.sql assumed a
-- physical location has exactly one authorized organization. That does not
-- hold here. This migration changes organization_location_assignments from
-- "exclusive owner of this location" to "organization authorized to
-- transact against this location": a physical inventory location may serve
-- multiple business organizations/brands at once. Inventory itself is not
-- split or duplicated - it remains one shared pool per (product_id,
-- location_id), exactly as it already was; only sale attribution becomes
-- organization-explicit instead of location-derived.
--
-- What did NOT need to change, and why (reviewed, not assumed):
--   - private.commit_sale already takes p_organization_id as an explicit
--     argument and already authorizes it via
--     private.assert_organization_location_scope(p_organization_id,
--     p_location_id), which was always a pair-existence check, never an
--     exclusivity check. It required zero changes.
--   - private.assert_sale_actor already restricts a 'manager' actor to their
--     own user_profiles.location_id; that is independent of how many
--     organizations are authorized at that location.
--   - private.assert_product_organization_scope only inspects a product's
--     own owner_location_id (null = shared catalogue, unaffected; not null =
--     workspace product, checked against ITS OWNER's own active
--     organization, never against how many organizations share the selling
--     location). Multiple organizations at REG cannot loosen or break this.
--   - public.process_paid_sale_webhook and public.admin_upsert_sales_channel_config
--     already derive organization/location from an explicit
--     private.sales_channel_configs row per provider (not a location
--     lookup), and that table has no location-uniqueness constraint - two
--     providers can already legitimately bind the same location to two
--     different organizations.
--   - sales_organization_namespace_external_order_key is already keyed by
--     (organization_id, order_namespace, external_order_id): two
--     organizations reusing the same external order id were never at risk
--     of colliding.
--   - The internal-sale replay guard in private.commit_sale already compares
--     v_sale.organization_id <> p_organization_id and raises
--     IDEMPOTENCY_KEY_REUSED on a mismatch, so a client that (mis)reuses one
--     request_id across two organizations fails loudly instead of silently
--     misattributing a sale.
--
-- What DID need to change: the one place that assumed a location maps to
-- exactly one organization was the *public* entry point, which derived
-- organization_id from location_id with a singular (non-deterministic once
-- two rows can match) lookup, and the admin RPC/index that enforced that
-- assumption at the data layer.

-- 1. Drop the exclusivity index. The (organization_id, location_id) primary
--    key on organization_location_assignments remains the only uniqueness
--    guarantee needed: it prevents a duplicate row for the same pair, and
--    that is the correct invariant now that a location may legitimately
--    have more than one active organization.
drop index if exists public.organization_location_one_active_organization;

-- 2. Admin assignment RPC: remove the exclusivity rejection
--    (LOCATION_ALREADY_ASSIGNED_TO_ANOTHER_ORGANIZATION no longer applies),
--    and add the organization/location active-state validation the removed
--    exclusivity check had been incidentally relying on the FK for. Signature
--    is unchanged, so existing grants on this function carry over untouched.
create or replace function public.admin_assign_organization_location(
  p_organization_id uuid,
  p_location_id uuid,
  p_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
begin
  v_actor := private.require_active_admin();
  if p_organization_id is null or p_location_id is null then
    raise exception 'INVALID_ORGANIZATION_ASSIGNMENT' using errcode = '22023';
  end if;
  -- Only require the organization/location to be active when *activating*
  -- an assignment; an admin must always be able to deactivate a stale
  -- assignment even if the organization or location was deactivated since.
  if p_active and not exists (
    select 1 from public.organizations where id = p_organization_id and active
  ) then
    raise exception 'ORGANIZATION_INACTIVE' using errcode = '22023';
  end if;
  if p_active and not exists (
    select 1 from public.locations where id = p_location_id and active
  ) then
    raise exception 'LOCATION_INACTIVE' using errcode = '22023';
  end if;
  -- A physical inventory location may serve multiple business
  -- organizations/brands at once (e.g. REG serving both 247TRUCK and AWT).
  -- The former one-active-organization-per-location exclusivity check is
  -- deliberately not re-asserted here; see the dropped
  -- organization_location_one_active_organization index above.
  insert into public.organization_location_assignments(
    organization_id, location_id, active, assigned_by
  ) values (p_organization_id, p_location_id, p_active, v_actor)
  on conflict (organization_id, location_id) do update
    set active = excluded.active, assigned_at = now(), assigned_by = excluded.assigned_by;
end;
$$;

-- 3. public.commit_sale: this is the one place that actually assumed a
--    location has exactly one organization. Its old body did
--    `select organization_id into v_organization_id from
--    organization_location_assignments where location_id = p_location_id
--    and active` - a singular derivation that becomes non-deterministic
--    (PL/pgSQL silently keeps one arbitrarily-chosen matching row) the
--    moment a location has two active organizations. Replaced with an
--    explicit, caller-supplied p_organization_id, authorized exactly the
--    same way private.commit_sale already authorizes it (an active
--    organization_location_assignments row for that exact pair) plus the
--    existing actor/location check - neither of which is new: both already
--    lived inside private.commit_sale and are unchanged by this migration.
--
--    The old 3-argument signature is explicitly revoked and dropped so the
--    location-derived (and now unsafe-under-shared-locations) path cannot
--    remain callable alongside the new one.
revoke execute on function public.commit_sale(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
drop function if exists public.commit_sale(uuid, uuid, jsonb);

create function public.commit_sale(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_organization_id is null then
    raise exception 'INVALID_SALE_INPUT' using errcode = '22023';
  end if;
  -- Source stays hardcoded 'internal' and price stays server-derived, exactly
  -- as before; only the organization is now an explicit, independently
  -- authorized input instead of an implicit location-derived one.
  -- private.commit_sale performs the actual authorization (actor/location
  -- via assert_sale_actor, organization/location pair via
  -- assert_organization_location_scope) - unchanged from before this
  -- migration, and correct for a shared location without any edit.
  return private.commit_sale(p_request_id, v_actor, p_organization_id, p_location_id,
    'internal', null, null, p_items, null);
end;
$$;

revoke execute on function public.commit_sale(uuid, uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.commit_sale(uuid, uuid, uuid, jsonb)
  to authenticated;
