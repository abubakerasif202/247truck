-- Removes the legacy `awt_*` integration surface, per the review and plan in
-- (the now-superseded) docs/legacy-awt-schema-cleanup.md.
--
-- This was an earlier Adelaide Wholesale Tyres integration design, applied
-- directly to production on 2026-09-12 and superseded the same week by
-- 20260913110000_adelaide_inventory_integration. It was left in place,
-- inert: `private.awt_integration_users` is empty, so every `public.awt_*`
-- entry point (all SECURITY DEFINER, all executable by any authenticated
-- user) raises ACCESS_DENIED before touching the ledger. That still left an
-- authenticated-user-executable SECURITY DEFINER surface capable of
-- mutating inventory_balances.reserved and posting stock_out movements,
-- with only an empty allow-list table standing in the way.
--
-- Re-verified immediately before this migration (2026-09-15):
--   awt_integration_users: 0 rows
--   awt_checkouts: 0 rows, never written (max(updated_at) is null)
--   awt_product_links: 24 rows, redundant with adelaide_product_mappings (24/24 match)
--   audit_events: 0 rows mentioning awt
--   no views/triggers/functions depend on these objects
--
-- Nothing in the ledger (inventory_balances, inventory_movements,
-- audit_events) is touched by this migration. Rollback: the recorded
-- 20260912191902_awt_regency_inventory.sql recreates the objects if ever
-- needed; the product links can be re-derived from adelaide_product_mappings.

revoke execute on function public.awt_availability(), public.awt_reserve(text,text,jsonb),
  public.awt_settle(text,text), public.awt_pending_checkouts() from authenticated;
drop function if exists public.awt_settle(text,text);
drop function if exists public.awt_reserve(text,text,jsonb);
drop function if exists public.awt_pending_checkouts();
drop function if exists public.awt_availability();
drop function if exists private.awt_location();
drop table if exists private.awt_checkouts;
drop table if exists private.awt_product_links;
drop table if exists private.awt_integration_users;
