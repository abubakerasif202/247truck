# Inventory production deployment and operations

## Environment variables

Production server-only variables:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AWT_INVENTORY_CLIENT_ID`
- `AWT_INVENTORY_CLIENT_SECRET` (at least 32 random bytes, shared only through each platform's encrypted secret store)
- `AWT_INVENTORY_LOCATION_ID` (approved Regency inventory location UUID)
- `CRON_SECRET` (at least 32 random bytes)

Public variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_INVENTORY_APP_URL`

Generate HMAC/cron secrets with `openssl rand -hex 32` or `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()`. Rotate by deploying the new value to the inventory service, then the website, performing a signed smoke test, and removing the old secret. A rotation needs a coordinated maintenance window because the protocol intentionally accepts one active secret.

Never place service-role or HMAC secrets in `NEXT_PUBLIC_*`, browser code, logs, support tickets or committed env files.

## Scheduled operations and alerts

Vercel invokes protected endpoints from `vercel.json`: expiry every ten minutes, paid-commit retry every five minutes, and reconciliation hourly. `/api/integrations/adelaide/health` requires `Authorization: Bearer $CRON_SECRET` and returns aggregate counts only. Alert on HTTP 503 or any `action_required` state: stale/missing expiry runs, expired active reservations, paid orders awaiting commit, three or more failed attempts, mapping failures, or critical reconciliation errors.

Each run records start, finish, duration, processed/failure count, status and a safe error code in `adelaide_operation_runs`. Integration delivery identity is recorded in `adelaide_integration_requests`; payload bodies and secrets are not stored.

## Mapping procedure

1. Import the website's reviewed catalogue manifest into `adelaide_website_products` with stable IDs.
2. Match only exact brand, pattern, size, condition and branch.
3. Have an Admin approve the permanent mapping ID; never map to a merely similar tyre.
4. Run `npm run verify:mappings -- --output artifacts/adelaide-mapping-validation.json` against the target database.
5. Require exit code 0 and `unmappedOrInvalidProducts: 0` before deployment.

The known `greforce-g-pilot-x1-29580r225` product is deliberately registered as a blocker because no unique active inventory product was available. Create/approve the real catalogue product through normal inventory administration before mapping it; do not fabricate it in a migration.

## Reconciliation and manual recovery

Admins use `/settings/reconciliation`. It is non-destructive and exports investigation identifiers in each row: order reference, reservation, mapping, inventory product and request ID. Follow the row-specific guidance. Never delete or edit a movement. Compensating stock or financial entries require a separately reviewed forward function/migration and supporting payment/fulfilment evidence.

For `paid_without_committed_inventory`, use **Retry commit**. This requeues the same durable commit identity. After the worker succeeds, confirm exactly one movement per expected reservation line and rerun reconciliation. Released/expired paid orders, mismatched quantities, or committed-without-paid rows always require manual investigation.

Orphaned Auth invitations appear under `/settings/users`. Verify the Auth user and durable invitation operation before compensation; do not expose account existence outside the Admin screen.

## Deployment order

1. Back up and record migration history. Apply `20260913120000_inventory_production_hardening.sql` after all earlier migrations.
2. Verify RLS/ACLs, function search paths, mapping report, health function and reconciliation on the database.
3. Deploy the inventory application with all server-only secrets and verify the protected cron/health routes.
4. Deploy the Adelaide website durable paid-order outbox described in `adelaide-website-integration-contract.md`.
5. Execute the controlled cross-system smoke test, including a duplicate delivery and an uncertain-response/status recovery.
6. Run mapping validation and reconciliation; require no unexplained critical result.

Do not reverse steps 3 and 4: the website must never emit the new workflow before the inventory schema and endpoints exist.

## Local and production smoke commands

```powershell
Set-Location -LiteralPath 'C:\Users\abuba\247truck\inventory-app'
npm ci
supabase db reset --local --yes
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:critical-coverage
npm run test:e2e
npm run build
npm audit --omit=dev
npm run verify:mappings -- --output artifacts/adelaide-mapping-validation.json
```

Destructive tests require `SUPABASE_TEST_ALLOW_DESTRUCTIVE=true` and the local URL `http://127.0.0.1:55331`. The fixture guard rejects known production project refs.

## Rollback

Disable website integration traffic and cron delivery first, then roll the inventory application back to its prior immutable deployment. Retain the new schema and all reservation, outbox, operation, request, audit, movement, invoice, payment and refund rows. Do not down-migrate or delete history. Active unpaid holds may expire normally; paid/manual-review rows remain protected. Any schema correction is a new forward-only migration.
