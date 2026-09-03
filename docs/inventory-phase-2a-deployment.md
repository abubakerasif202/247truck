# Inventory Phase 2A purchasing deployment

Phase 2A is an internal inventory-app release only. Do not link this checkout
to a remote Supabase project, run `supabase db push`, or use production keys
as part of local verification.

## Pre-deployment checks

1. Review the seven Phase 2A migrations in `inventory-app/supabase/migrations/`:
   `20260903090000` through `20260903093000`, plus
   `20260904090000_purchase_receipt_integrity.sql`.
2. Confirm the target is the intended non-production database and take an
   approved backup before applying any migration outside the disposable stack.
3. Supply the application URL, publishable key, and service-role key only as
   server-side deployment settings. `SUPABASE_SERVICE_ROLE_KEY` must never use
   a `NEXT_PUBLIC_` name or appear in browser bundles.
4. Run the local release gate below against the unlinked `127.0.0.1` stack.

## Local release gate

```powershell
Set-Location -LiteralPath 'C:\Users\abuba\247truck\inventory-app'
npx.cmd supabase db reset --yes
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run build
npm.cmd run test:integration
npm.cmd run test:e2e
```

The integration and E2E suites require `SUPABASE_TEST_*` values pointing only
at the disposable local stack and `SUPABASE_TEST_ALLOW_DESTRUCTIVE=true`.

## CI policy

The database job is normally controlled by the `RUN_INVENTORY_DB_TESTS`
repository variable. During Phase 2A PR validation it is temporarily forced
for the `feat/inventory-phase-2a-purchasing` head branch so the ephemeral local
Supabase integration and browser suites cannot be skipped. Restore the normal
opt-in condition in a separate cleanup commit only after the PR’s static and
database jobs are green.

## Post-deployment smoke checks

Use a controlled internal account to verify the appropriate location scope:

- a LON Manager can create, submit, and receive only LON purchase orders;
- an Admin can approve submitted orders;
- partial and final receipts update outstanding quantity and order status;
- reorder suggestions disappear once the received stock meets the threshold.

Do not treat a green local check or a READY hosting deployment as evidence that
production database migrations or secrets are configured.
