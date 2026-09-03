# Inventory Phase 2A purchasing deployment

Phase 2A adds suppliers, purchase orders, goods receiving, receipt-integrity
hardening, and smart reordering to the inventory app.

**Production status: COMPLETE.** All seven Phase 2A migrations are applied to the
production inventory database and verified. The sections below document the
verified production target, the procedure that was used, the smoke-test
checklist, and the security model that was confirmed.

## Environments

| Environment | Supabase | Notes |
|---|---|---|
| **Inventory production** | project ref `afefdlvepdbtaxoscwew`, name **247truck**, region **ap-southeast-2** | The only database Phase 2A production migrations are applied to. |
| Local / disposable | `127.0.0.1` stack from `inventory-app/supabase/config.toml` (`project_id = "247truck-inventory"`) | Ephemeral. Used for `db reset`, integration, and E2E suites. Never linked to a remote project. |
| Integration-test Supabase | separate disposable project | Listed in `FORBIDDEN_PROJECT_REFS`; destructive fixtures only. |
| Marketing website Supabase | a different project entirely | **Not** the inventory database. Never target it with inventory migrations. |
| Other business projects (e.g. Gala-rentals) | unrelated | Never target with inventory migrations. |

The inventory production project is **distinct** from the marketing Supabase
project, from localhost / the local disposable stack, from any test environment,
and from every other business project.

Never place database passwords, service-role keys, access tokens, JWT secrets,
or full credential-bearing connection strings in this document or in logs.
`SUPABASE_SERVICE_ROLE_KEY` must never use a `NEXT_PUBLIC_` name or appear in
browser bundles; supply it only as a server-side deployment setting.

## Production migration state

Production migration history (`supabase_migrations.schema_migrations`) contains
exactly these versions, each once:

Phase 1:

- `20260902090000` identity_access
- `20260902091000` product_catalog
- `20260902092000` inventory_ledger
- `20260902093000` inventory_summary

Phase 2A:

- `20260903090000_purchasing_permissions_suppliers.sql`
- `20260903091000_purchase_orders.sql`
- `20260903091500_purchase_order_draft_creation.sql`
- `20260903091600_purchase_order_draft_update.sql`
- `20260903092000_goods_receiving.sql`
- `20260903093000_smart_reordering.sql`
- `20260904090000_purchase_receipt_integrity.sql`

Verified:

- All seven Phase 2A migrations are applied in production.
- Each canonical migration version exists exactly once.
- No generated timestamp aliases remain; migration history is clean.
- Phase 1 seed and bootstrap data remained intact (2 locations, 1 admin
  profile, 9 product categories, login audit rows only).
- Phase 2A schema, RLS, and grants were verified after deployment.
- No production business data (suppliers, POs, receipts, stock movements) was
  created during deployment or verification.

## Deployment procedure

This is the procedure that was used and is the recommended production workflow.
Run it from a clean checkout of `main`, not from a stale feature worktree.

```
cd inventory-app
npx supabase login
npx supabase link --project-ref afefdlvepdbtaxoscwew
npx supabase db push --dry-run
```

Review the dry-run output carefully. It must list only migrations that are
genuinely not yet applied. Only when the pending list is correct:

```
npx supabase db push
```

Production migration history must always use the canonical repository migration
versions (the file-name timestamps above), never generated timestamps.

### Warnings

- **Never** run `supabase db reset` against production.
- **Never** run local integration or E2E fixtures against production. The test
  harness lists the production ref in `FORBIDDEN_PROJECT_REFS` for this reason.
- **Never** run `db push` without first checking `db push --dry-run`.
- **Never** expose Supabase credentials in logs or documentation.
- **Do not** use `--include-all` or `supabase migration repair` to bypass an
  unexpected migration mismatch.
- If migrations that should already be applied unexpectedly appear as pending,
  **STOP** and investigate the production migration history before running
  `db push`.

## Production smoke test

Performed **after** database migration. Must not use automated destructive test
fixtures. Use a controlled internal Admin or LON Manager account.

### Authentication

1. Open the production inventory application.
2. Sign in using an authorized Admin or LON Manager account.
3. Confirm the dashboard loads without 500 errors, missing-relation errors,
   missing-RPC errors, or unexpected permission errors.

### Suppliers

1. Open Suppliers.
2. Confirm the supplier list loads.
3. Open the new supplier form.
4. Confirm fields render normally.

Do not create a supplier solely for smoke testing unless using an approved
real/test business record.

### Purchase Orders

1. Open Purchase Orders.
2. Confirm the list loads.
3. Open New Purchase Order and confirm the supplier control loads, product
   selection loads, location selection is correct, and validation renders.
4. Open an existing PO if available; confirm PO detail and action controls
   render.

### Receiving

Using an approved non-critical PO only:

1. Open an approved / sent / partially-received PO.
2. Confirm the Receive Stock UI loads.
3. Confirm line quantities display correctly.
4. Confirm receiving controls are available only to an authorized user (a LON
   Manager sees only LON purchase orders; an Admin can approve submitted
   orders).
5. If a legitimate receipt is recorded, confirm partial and final receipts
   update the outstanding quantity and the order status.

If an approved production test transaction is performed: use a legitimate PO,
use the correct quantity, verify the stock movement afterwards, and record the
request/receipt for audit purposes. Never create dummy stock movements on
production just to prove the page works.

### Smart Reordering

1. Open Smart Reordering / reorder suggestions.
2. Confirm settings load.
3. Confirm the suggestions query returns without RPC or schema errors.
4. Confirm the draft-PO action is visible only when authorized.
5. Confirm a product's reorder suggestion clears once its received stock meets
   the configured threshold.

Do not generate unwanted purchase orders just to test the feature.

### Regression check

Confirm existing Phase 1 areas still work: Products, Inventory summary,
Inventory ledger, Stock counts, Locations, and user permissions /
authentication.

## Phase 2A security model (verified in production)

- `purchase_receipt` movements cannot be posted through the generic public
  inventory-movement RPC — that path raises
  `PURCHASE_RECEIPT_REQUIRES_PURCHASE_ORDER`.
- Receiving must go through `public.receive_purchase_order`.
- `purchasing.receive_po` authorization is enforced.
- Manager / location scope authorization is enforced.
- PO receiving state is validated (only receivable states accepted).
- Over-receiving beyond outstanding quantity is prevented.
- Duplicate receipt lines are rejected.
- Receipt attempts against a PO line that does not belong to the PO are
  rejected.
- Request-id idempotency is enforced (a reused key is rejected).
- Receipt processing is transactional (row locks held; all-or-nothing).
- Private receipt helper functions are not executable directly by `anon`,
  `authenticated`, or `service_role`.
- All Phase 2A `SECURITY DEFINER` functions use an empty/safe `search_path`.
- Receipt tables (`goods_receipts`, `goods_receipt_lines`, `document_sequences`)
  use restrictive RLS (enabled, no policies = default-deny) and grants; all
  writes flow through `SECURITY DEFINER` RPCs.

## Advisor findings

These findings did **not** block the Phase 2A release and are not silently
fixed as part of deployment.

Phase 2A / intentional:

- RLS-enabled tables with no policies, for the deliberately locked-down internal
  tables (`document_sequences`, `goods_receipts`, `goods_receipt_lines`).
- `authenticated` `SECURITY DEFINER` RPC advisories, consistent with the
  architecture (same pattern as the Phase 1 RPCs).

Pre-existing / not Phase 2A regressions:

- `security_definer_view` advisory on `inventory_product_summary`.
- Leaked-password protection disabled (Auth setting).
- Unindexed foreign-key advisory items (audit-user columns and Phase 1 tables);
  worth indexing once the tables carry real volume.

## CI policy

Database CI is normally controlled by the `RUN_INVENTORY_DB_TESTS` repository
variable. During Phase 2A validation the database job was temporarily forced on
the `feat/inventory-phase-2a-purchasing` feature branch so the ephemeral local
Supabase suites could not be skipped. Both the static and database jobs went
green, the temporary override was then removed in a separate cleanup commit
(`5292e94`), and normal opt-in gating is now restored. The override is no longer
active on any branch.

## Release state

Phase 2A production status: **COMPLETE**

- Database migrations: complete
- Schema verification: complete
- RLS / grants verification: complete
- Receipt-integrity verification: complete
- Phase 1 regression inspection: passed
- Application deployment: succeeded

Remaining operational action: a manual authenticated UI smoke test through the
Vercel-protected inventory deployment (the checklist above). Automated browser
access to production is blocked by Vercel deployment protection; this does not
make the release incomplete.
