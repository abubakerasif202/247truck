# Legacy `awt_*` schema — review and future cleanup plan

Status: **documented only — nothing removed, no migration created**. Reviewed 2026-09-13 after the
Adelaide Wholesale Tyres integration release.

## What exists in production

Migration `20260912191902_awt_regency_inventory` was applied directly to the production project on
2026-09-12 (an earlier integration design, superseded by `20260913110000_adelaide_inventory_integration`).
It was never committed at the time; a byte-identical copy now lives in
`inventory-app/supabase/migrations/` so local and remote history match.

| Object | Kind | Rows / notes |
| --- | --- | --- |
| `private.awt_integration_users` | table, RLS on, all grants revoked | **0 rows** — nobody is allow-listed, so every `public.awt_*` function raises `ACCESS_DENIED` |
| `private.awt_product_links` | table, RLS on, all grants revoked | **24 rows** — website id → product id; agrees 24/24 with `public.adelaide_product_mappings` |
| `private.awt_checkouts` | table, RLS on, all grants revoked | **0 rows**, never written (`max(updated_at)` is null) |
| `private.awt_location()` | SECURITY DEFINER function, execute revoked from all app roles | gate used by the public functions |
| `public.awt_availability()` | SECURITY DEFINER, execute granted to `authenticated` | read-only; unusable (gate) |
| `public.awt_reserve(text,text,jsonb)` | SECURITY DEFINER, execute granted to `authenticated` | would mutate `inventory_balances.reserved`; unusable (gate) |
| `public.awt_settle(text,text)` | SECURITY DEFINER, execute granted to `authenticated` | would post `stock_out` movements via `post_inventory_movement_with_notes`; unusable (gate) |
| `public.awt_pending_checkouts()` | SECURITY DEFINER, execute granted to `authenticated` | read-only; unusable (gate) |

## Dependencies and references

- No views, triggers or other functions depend on these objects (`pg_depend` rewrite dependents: 0).
- No application code in `247truck` (inventory app or marketing site) or in the Adelaide website
  references any `awt_*` object. The live integration uses only `adelaide_*` tables and RPCs.
- `public.audit_events` contains no `awt` event types; nothing has ever written to `awt_checkouts`.
- The 24 `awt_product_links` rows are redundant with `adelaide_product_mappings` (identical pairs).

## Risk assessment

- **Inert**: with `awt_integration_users` empty, every entry point fails before touching the ledger.
- **Residual exposure**: the four `public.awt_*` functions are SECURITY DEFINER and executable by any
  authenticated user. The only thing standing between an authenticated user and a reservation/stock-out
  is the empty allow-list table. That is acceptable short-term but is the reason to remove them.
- Removing them does not affect Adelaide, jobs, POS or finance (no references, no data in use).

## Future safe cleanup (do not apply yet)

1. Re-run the checks in this document (row counts, references, audit mentions) immediately before writing
   the migration; abort if `awt_checkouts` has rows or `awt_integration_users` is non-empty.
2. Create `supabase/migrations/<timestamp>_drop_legacy_awt_schema.sql`:
   ```sql
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
   ```
   Nothing in the ledger (`inventory_balances`, `inventory_movements`, `audit_events`) is touched.
3. Verify locally: `supabase db reset --local`, `npm run test:integration`, `supabase db lint --local`,
   `supabase db advisors --local` (the SECURITY DEFINER advisor count should drop, not rise).
4. Ship through the normal PR + CI path, then `supabase db push --linked --dry-run` (expect exactly this
   one file) and `supabase db push --linked`.
5. Post-apply read-only check: `select count(*) from pg_proc where proname like 'awt_%'` = 0; ledger
   totals unchanged.

Rollback: the recorded `20260912191902_awt_regency_inventory.sql` recreates the objects if ever needed
(links can be re-derived from `adelaide_product_mappings`).
