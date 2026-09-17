# Stage A release-readiness review — 17 September 2026

> **HISTORICAL.** This document's initial finding was RELEASE BLOCKED (Stage A, below). Stages B, C and D superseded that finding through remediation, verification, and — as of Stage D — actual production deployment. **Current status: PRODUCTION DEPLOYED — RELEASE READY.** See [Stage D — final production deployment status](#stage-d--final-production-deployment-status--17-september-2026) at the bottom of this document for the authoritative current state. Everything above Stage D is preserved as an audit trail and should be read as history, not current fact, except where a stage explicitly says otherwise.

## Decision: RELEASE BLOCKED (Stage A initial finding — SUPERSEDED, see Stage D)

Production deployment, migrations, data edits, auth settings and environment changes were not performed. No commit or push was made. Green regression tests do not resolve the remaining business/security boundaries below.

## Verified production state

Read-only Supabase checks in this execution identified project `247truck`, reference `afefdlvepdbtaxoscwew`, region `ap-southeast-2`, status ACTIVE_HEALTHY. Final migration/reconciliation refresh: **2026-09-16 21:51:24 UTC**.

- 54 registered migrations; latest `20260916151000_customer_returns_and_catalog_search`.
- Exactly two subsequent local migration files, unapplied in production:
  1. `20260916155821_harden_customer_return_replay_identity.sql`
  2. `20260916204935_generic_sales_webhook_organization_foundation.sql`
- None of the five new organization/sales/event tables exists in production.
- Locations: REG / Regency Park / `e2d89d79-e82d-4d82-97c4-da020c31feab`; LON / AWT Tyres Website / `0f15925e-8d00-48f2-b387-30c8bc98bc23`.
- Products 55, balances 110, movements 80, customers 1, suppliers 0, invoices 4, payments 0, job reservations 0, Adelaide reservations 2.
- All 55 products have null `owner_location_id`. No organization assignments were inferred from location names.
- Ledger/balance discrepancies **0**; negative on-hand **0**; reserved above on-hand **0**; negative available **0**; checked job/Adelaide reservation orphans **0**; duplicate non-null actor/location/request movement identities **0**.

### Adelaide mapping

24/25 active sellable products mapped. `greforce-g-pilot-x1-29580r225` remains unmapped (GREFORCE G-PILOT X1 295/80R22.5 new; mapping record `eb8976ea-067c-668c-ad01-5304b8207671`). No guessed mapping was inserted. That item cannot safely participate in mapped availability/reservation/commit operations. This catalog exception is **not by itself a blocker for the generic migration**, which has no complete-mapping dependency.

## Confirmed defects corrected locally

All changes are to the **unapplied** generic-sales migration, not historical production migrations.

1. **Hosted default privileges defeated the service-only webhook boundary.** Production defaults grant new public functions EXECUTE to authenticated directly. Revoking PUBLIC/anon alone did not remove it. Reproduced on the disposable database with matching defaults: the non-service denial test failed. The migration now revokes all four API roles before granting authenticated sales/admin entry points and service-role-only webhook execution. Local catalog and actual API denial tests now pass.
2. **Decimal prices were rejected.** An over-escaped SQL regex rejected `110.50`. Replaced its decimal separator with `[.]`; regression verifies two units total 221 and stock decreases only twice.
3. **Paid events without a business order key could bypass order-level deduplication.** Paid event types now require a nonblank external order ID before any event/stock write. Regression covers null, empty and whitespace keys with unchanged stock.

Red phase: 13 focused tests, 3 failed / 10 passed against the original migration under production-style defaults. Green phase: **13 passed, 0 failed, 0 skipped** after the corrected sequential upgrade.

## Remaining release blockers / scope decisions

### 1. Pricing and sale-source authority bypass the finance workflow

A rolled-back local diagnostic confirmed a manager with `pos.use` can call public `commit_sale` with zero unit price and `source='stripe'`. The public wrapper forwards both fields unchanged. The private implementation does not apply existing finance discount caps/reasons, customer-tier pricing or a server-owned payment source. The manager can therefore record a zero-value provider-labelled stock deduction without the existing finance authorization path.

Define and enforce the intended pricing/override policy and which callers may assert external payment sources. Do not silently choose that policy during a release audit. Reuse the existing finance authorization where appropriate; add negative authorization tests before release.

### 2. A stock-sale foundation is not an atomic payment integration

There is no actual Stripe webhook endpoint/signature validation or Stripe SDK in the inspected app. The RPC writes sale/items/movements/event/audit, **not payments or invoice financial documents**. Stock/sale rollback is tested; sale/payment atomicity is not implemented. A recognized `checkout.session.completed` string is treated as paid without a supplied/verified payment status. An eventual endpoint must verify the provider event and paid state before calling this trusted service RPC.

Ignored refund events are durably recorded and do not restock, but they do not create financial refund history. Existing finance refund workflows remain separate. Do not enable live provider delivery or advertise complete payment/refund accounting on this foundation.

### 3. Organization isolation is partial, not system-wide

The new sales path checks active organization/location assignment and manager location/`pos.use`. A foreign-location manager is denied. Direct writes to all five new tables are denied even to service_role; RLS is enabled. However, legacy products/customers/suppliers/invoices/payments are not migrated into organization scope. Product selection checks active product plus a balance at the sale location, not product ownership or a used-unit lifecycle. Existing balances may legitimately cross location boundaries, so ownership policy cannot be guessed.

Assignment changes are not serialized with sales: the scope helper is a stable read, and the admin assignment RPC can deactivate/reassign a location without a shared sale lock. Full organization isolation and assignment-transition behavior need a defined contract and negative/race tests before claiming tenant-safe release.

### 4. Business identity still needs a cross-channel contract

Two concurrent provider events with the **same nonblank order, organization and source** now produce one sale/movement. Provider+event replay and sale-request replay also pass. The unique business key remains `(organization_id, source, external_order_id)`: website and stripe represent different namespaces. If both paths represent the same real checkout, they can still create separate effects. The webhook also hardcodes sale source `stripe` for every accepted provider. Decide canonical order/provider identity before connecting additional delivery channels; do not invent mappings.

Failed events remain durably failed on replay, rather than being reprocessed. A paid-but-out-of-stock event needs an explicit recovery/refund/reconciliation procedure. The event replay comparison does not independently bind actor/items/scope, relying on the trusted supplied payload hash; the caller contract must enforce that binding.

### 5. Existing private finance helper needs targeted authorization hardening

Fresh production catalog/body review found `private.finance_issue_locked(uuid,integer)` executable by authenticated with private-schema USAGE, but without its own actor/location authorization. It updates invoice financial state by ID. This is a database authorization boundary concern, **not a proven public HTTP exploit**: exposure of the private schema through PostgREST was not established. Review callers and restrict direct execution through a separately reviewed forward migration. Do not mass-revoke all SECURITY DEFINER functions.

### Other correctness findings to resolve

- Generic sale GST is rounded per unit then multiplied; existing finance code rounds line totals. Decimal multi-quantity cases can disagree (e.g. 3 × 0.05 gives 0.00 versus line-rounded 0.01). Align with the established finance calculation before using these totals as financial records.
- Generic sales do not consume specific used-tyre unit identities. Prove the lifecycle or explicitly exclude unit-tracked products before rollout.
- Customer-return replay deliberately treats omitted cost as stored effective cost; explicit-to-null replay cannot be distinguished from the ledger alone. Location is part of the request identity. The migration plan now documents this instead of promising global request-key uniqueness or rejecting every changed cost.
- Not every one of the 144 existing authenticated SECURITY DEFINER bodies was exhaustively re-audited. Catalog grants/search paths and the important helper above were inspected; this is not a blanket authorization certificate.

## Migration-by-migration safety

### 20260916155821 — return replay

Replaces the existing function with the same argument/return signature and authenticated-only API grant. No table/column drop, destructive ALTER, TRUNCATE, DELETE, backfill, table rewrite or history update. Advisory locking remains actor/location/request scoped. The only intended behavior change is ignoring derived inbound cost when a customer-return caller omits it. It delegates authoritative stock mutation to the existing function. Finance immutability triggers are untouched.

### 20260916204935 — organization/sales foundation

Creates five new tables and indexes/triggers/functions; seeds two organization labels but **zero location assignments**. NOT NULL constraints apply only to new tables, so existing unassigned records are not backfilled or rejected. No existing table rewrite or bulk legacy update. Referenced parent tables acquire normal DDL/FK locks; deployment still needs a quiet window, bounded lock wait and rollback on transaction failure. There is no claim of zero locking.

All six new/replaced generic helper/entry-point functions use empty search_path. All five new tables are RLS-enabled and revoke direct writes from anon/authenticated/service_role. Service role has read access to durable outcomes only. Private helpers grant none of those API roles EXECUTE. Corrected public grants are explicit and no longer depend on hosted defaults. Inventory row locks are acquired in product-ID order; the nested webhook exception block rolls back all sale/stock changes while retaining a failed event.

Existing invoice guards `invoice_lines_guard`, `invoice_revisions_guard`, `invoices_identity_guard`, `invoices_require_current_revision`, `payments_immutable` and `refunds_state_guard` remain enabled. Expected negative tests raising FINANCE_HISTORY_IMMUTABLE / INVOICE_FINANCIAL_LOCKED / INVOICE_CREDIT_LOCKED must not be suppressed by weakening guards.

## Supabase advisors

Fresh results, not the previous report:

| Finding | Classification / action |
| --- | --- |
| 32 RLS-enabled/no-policy tables | INTENTIONAL: checked anon/authenticated table and column privileges deny direct data access; RPC/service-owned tables. |
| Four anon-executable private SECURITY DEFINER functions | Anon lacks private-schema USAGE. Three are trigger-only helpers: LOW RISK redundant grants. The invoice issue helper also has authenticated access: NEEDS HARDENING BEFORE RELEASE as described above. |
| 144 authenticated SECURITY DEFINER functions | 136 public, 8 private; empty search paths checked. Grants alone are not proof of authorization; targeted helper finding blocks broad security sign-off. |
| Leaked-password protection disabled | Production security recommendation only; auth configuration not changed. |
| 57 unindexed foreign keys; 77 unused indexes | POST-RELEASE OPTIMIZATION with workload evidence; no automatic index deletion or blanket index creation. |

## Populated upgrade rehearsal

Disposable local project `247truck-inventory` only, API loopback 55331, database container `supabase_db_247truck-inventory`. Reset specifically to `20260916151000`, then ran existing inventory-concurrency and finance-POS suites: **6/6 passed** to populate baseline records. Mirrored production's postgres-owned public-function default grants before applying the two pending migrations with `supabase migration up --local`.

Confirmed registration/order `20260916151000` → `20260916155821` → `20260916204935`. Before/after counts and deterministic row fingerprints were identical for 13 existing tables: locations, products, balances, movements, customers, suppliers, invoices, invoice revisions, invoice lines, payments, job reservations, Adelaide reservations and Adelaide reservation lines.

Nonempty baseline included 2 products, 4 balances, 28 movements, 4 invoices, 4 revisions, 4 invoice lines, 2 payments, 2 job reservations and 1 customer. Immediately after upgrade there were zero organization assignments. Actual grants returned authenticated webhook EXECUTE=false, service_role=true. All five new tables denied direct API-role writes.

Limitations: synthetic local data, not production backup restore; empty supplier/Adelaide baseline tables; no production traffic/lock contention/scale or Supabase-managed-role parity simulation beyond the relevant function defaults. This proves a populated schema upgrade and preservation, not every production operational condition.

## Final validation

Fresh final-tree gates completed after the local fixes and populated upgrade:

| Command | Result |
| --- | --- |
| `npm run test:integration` | **372 passed, 0 failed, 0 skipped, 0 failed suites**; exit 0 |
| `npm run test:unit` | **399 passed**, 59 files; no skipped tests reported; exit 0 |
| `npm run test:critical-coverage` | **55 passed**; statements 91.89%, branches 92.42%, functions 92.30%, lines 94.73%; exit 0 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS; Next.js 16.3.3, 48/48 generated pages |
| `npm audit --omit=dev` | PASS; 0 vulnerabilities |
| `git diff --check` | PASS |

Logs are local-only under `.test-results/stage-a/`; never include them or credentials in commits. `.env.local`, `.test-results`, `.next` and coverage outputs are confirmed ignored. Node v22.23.1 / npm 10.9.8. Browser E2E, production application smoke and real provider delivery were not rerun in this Stage A execution; no production deployment occurred. The code-verification skill informed the separation between passing regression gates and an unsafe release verdict.

Focused coverage includes 6+6 and 2+3 stock races, an actual simultaneous job-reservation/sale race, concurrent same-sale request, duplicate event, different events/same order, full multi-line rollback, decimal price and missing order rejection, access denial, and refund/physical-return separation. Existing Adelaide tests cover reservation replay/commit replay, competing holds, release/commit and expiry/commit races. This does not substitute for the unresolved cross-channel and payment-state contracts.

## Git scope and proposed commit preparation

Branch `fix/inventory-branch-safety-ci`, base HEAD `ff9cc22`; remote `https://github.com/abubakerasif202/247truck.git`. The repository root is one directory above the app. Existing user changes were preserved.

Candidate release files (relative to `inventory-app/`; **not authorization to deploy**):

1. `supabase/migrations/20260916155821_harden_customer_return_replay_identity.sql`
2. `tests/integration/inventory-rpc.test.ts`
3. `scripts/run-integration-tests.mjs`
4. `package.json`
5. `vitest.config.ts`
6. `tests/integration/review-cancel-idempotency.test.ts`
7. `supabase/migrations/20260916204935_generic_sales_webhook_organization_foundation.sql`
8. `tests/integration/generic-sales-webhook.test.ts`
9. `.env.example`
10. `docs/production-migration-plan-20260916155821.md`
11. `docs/stage-a-release-readiness-20260917.md`

Excluded: pre-existing `supabase/.temp/cli-latest` tool churn; `.test-results`, coverage/build artifacts, `.env.local`, secrets and temporary logs. No unrelated source file was modified. Untracked migration/test/docs files must be explicitly staged; `git diff --stat` alone omits them.

Proposed logical commits, not created while blockers remain:

- `fix(inventory): preserve optional-cost return replay identity`
- `test(inventory): harden local integration runner and diagnostics`
- `feat(inventory): add scoped sales and webhook ledger foundation` — **hold until blockers resolved**
- `docs(inventory): record release gates and migration boundaries`

## Release configuration, sequencing and recovery

No production configuration is changed in Stage A. Obtain explicit organization/location ownership, accepted product scope and pricing policy, canonical provider/order mapping, verified paid-state/signature contract and failure recovery workflow. The Stripe environment names are only future server-side placeholders; never NEXT_PUBLIC. Do not configure a live webhook for a nonexistent endpoint.

After blockers are resolved, all gates rerun, a verified logical backup is taken and separate explicit production authorization is received: apply return migration first; verify registration/signature/grants/reconciliation; only then apply generic migration and repeat schema/grants/reconciliation and non-mutating application health checks. Never create fake sales/invoices or move real stock for smoke testing.

If a migration transaction fails, stop and inspect; do not continue to the second migration. After an applied migration, prefer a new reviewed forward-fix migration. For the return function, restore the prior reviewed function body through a new migration if necessary. For sales, disable new callers via reviewed grants/config, preserve all durable sales/events/movements, then repair forward. Never delete ledger or financial history, drop populated tables, reset production or erase migration registration as rollback.

Stage A ends here. Production application/deployment is not authorized. Website and inventory repositories remain separate; no Ever Gauzy code was copied and no secrets were added to candidate files.

> **SUPERSEDED.** Production deployment did later occur, in Stage D below, after Stages B and C resolved every blocker identified here and additional multi-brand/organization-scope work was independently reviewed and verified. See Stage D for the authorization record and final production state.

## Stage B remediation — 17 September 2026 (same day, local only)

### Decision: RELEASE BLOCKED — organization isolation for product ownership only; everything else RESOLVED

No production deployment, migration, or configuration change occurred in Stage B. No push, merge, or commit was made. All work is local edits to the two unapplied migrations plus a new forward migration and expanded tests.

### What changed

`supabase/migrations/20260916204935_generic_sales_webhook_organization_foundation.sql` was edited in place (chosen over layering a forward-fix, per the migration-strategy decision below). `private.finance_issue_locked` is hardened by a **new** forward migration, `20260917130000_harden_finance_issue_locked_execute.sql`, because `20260908120000_phase_4c_manual_payments_receivables.sql` is already applied to production and is never edited after the fact.

1. **Pricing/source authorization (blocker #1) — RESOLVED.** `public.commit_sale` no longer accepts `p_source`, `p_organization_id`, or `p_external_order_id` from the caller: its signature is now `(p_request_id, p_location_id, p_items)`. Source is hardcoded `'internal'`; organization is derived server-side from the location's own active `organization_location_assignments` row (the partial unique index on `location_id` guarantees exactly one active organization per location, so the derivation is sound and cannot be spoofed). A caller can no longer assert `source='stripe'` or select a foreign organization by naming its id — those parameters simply do not exist on the entry point any more. Item price is no longer caller-supplied at all: `p_items` containing an `unit_price_incl_gst` key is rejected with `INVALID_SALE_ITEM`; price is always derived server-side from `private.product_sale_price(product_id, 'retail')`, the same authoritative pricing helper the existing retail/wholesale pricing feature already uses and gates behind `inventory.edit_global_price`. This is a genuine fail-closed behavior change: a product with a null retail price can no longer be sold through this path at all (`SALE_PRICE_REQUIRED`), and a product priced at 0 will legitimately zero-deduct — both are now authorized data, not attacker input.
2. **Payment integration boundary (blocker #2) — RESOLVED as a boundary, not as a live integration.** A new private table, `private.sales_channel_configs`, binds each `provider` string to exactly one organization, location, order-identity namespace and expected currency; it is seeded **empty** and is reachable only through `public.admin_upsert_sales_channel_config` (admin-only, itself re-validates the org/location pair is an active assignment). `public.process_paid_sale_webhook` looks up this config by provider and fails closed with `UNKNOWN_PROVIDER` before any row is persisted if the provider is not configured — so paid-channel processing is fail-closed exactly as Stage A required, with no live Stripe SDK or signature verification invented. The function now also requires `p_amount_total`/`p_currency` and rejects a mismatch against the configured currency (`PAYMENT_CURRENCY_MISMATCH`) or against the server-computed sale total (`PAYMENT_AMOUNT_MISMATCH`, raised inside the same transaction as the stock/sale writes so the whole thing rolls back). A caller-controlled `paid=true`/event-type string alone is still insufficient: no sale is created unless a configured provider, a valid amount and a valid currency all agree with the server's own computation.
3. **Cross-channel order identity (blocker #4) — RESOLVED, with the namespace decision recorded here.** The uniqueness key changed from `(organization_id, source, external_order_id)` to `(organization_id, order_namespace, external_order_id)`, where `order_namespace` is a property of the channel config, not of the individual event. Rationale: `source` was a technical/provider label (`website`, `stripe`) that does not correspond to "the same real storefront" — two providers fronting the same checkout should share a namespace so a retry through either one collapses to one sale, while two genuinely unrelated providers get distinct namespaces so an external-ID collision between them is never treated as the same order. The advisory lock used to serialize concurrent deliveries for the same order was moved from a `source`-keyed lock to a `order_namespace`-keyed lock — without that change the namespace fix would not hold under concurrency, since two channel aliases could still race each other. `public.process_paid_sale_webhook` no longer hardcodes `source='stripe'`; it uses whatever `source` the matched provider's config declares.
4. **Organization isolation (blocker #3) — RESOLVED for location scope; product ownership remains an explicit open item, not resolved.** Every entry point (`commit_sale`, `process_paid_sale_webhook`, `admin_upsert_sales_channel_config`) derives organization/location from a server-side lookup — a stable active assignment row or an admin-bound channel config — never from a caller-supplied organization id. Cross-location denial is tested directly (a REG manager cannot sell at LON) and channel-config binding to an org/location pair that lacks an active assignment is rejected. This closes the "Org A caller + Org B location" class entirely for the generic-sales surface. It does **not** close product ownership: product selection still checks `products.active` only, with ownership enforced transitively through `location → organization`. That is sound unless a product carries an `inventory_balances` row at a location belonging to a different organization than the one it was catalogued under — and Stage A's own production read confirmed all 55 products have `owner_location_id = null` with cross-location balances potentially legitimate. Closing that fully would require inventing product-ownership data this remediation was explicitly told not to invent. This is why the overall Stage B decision is not a clean RESOLVED.
5. **Private invoice-helper permissions (blocker #5) — RESOLVED, narrowly.** `20260917130000_harden_finance_issue_locked_execute.sql` revokes EXECUTE on `private.finance_issue_locked(uuid, integer)` from `public, anon, authenticated, service_role`. Its only two callers, `public.issue_invoice` and `public.finalise_pos_sale`, already perform their own `private.finance_guard('invoices.issue', ...)` authorization before calling it, so no legitimate caller loses access. The other three anon-executable private helpers the Stage A advisor scan found (report line 93) are trigger-only and were classified LOW RISK; they are deliberately **out of scope** here — this remediation does not mass-revoke SECURITY DEFINER functions, per the original instruction.

### Other Stage A findings addressed in the same edit

- **GST rounding** now matches the existing finance convention: `tax_amount = round(line_total / 11, 2)` per line, computed after `line_total = round(unit_price * quantity, 2)`, instead of rounding a per-unit tax and multiplying by quantity. Verified directly: 3 × $0.05 now yields line total $0.15 / GST $0.01, matching finance's line-rounded convention instead of the old $0.00.
- **Retryable webhook failures no longer poison the event ledger.** `process_paid_sale_webhook`'s exception handler now re-raises `40001` (serialization_failure) and `40P01` (deadlock_detected) instead of durably recording them as `'failed'`, so a genuinely retryable database contention event can be retried by the caller rather than being permanently stuck.
- **Missing-order rejection, insufficient-stock rollback atomicity, and reservation exclusion** are preserved from Stage A and each has a direct regression test (see below); reservation exclusion additionally now has a deterministic non-race test (stock 10, reserve 9, attempt to sell 2 → `INSUFFICIENT_STOCK`; sell 1 → succeeds and leaves `on_hand=9, reserved=9`), not only the original concurrent-race test.

### Verification performed

- `npx supabase db reset --local --yes`: all 57 migrations (including the two edited/added ones) apply cleanly to a fresh database.
- `tests/integration/generic-sales-webhook.test.ts`: rewritten to the new signatures and expanded from 13 to **21** tests, covering: server-derived pricing rejection of a caller-supplied price, unconfigured-provider fail-closed with zero persisted rows, admin-only channel-config binding with an org/location-assignment check, same-order-via-two-channel-aliases collapsing to one sale, unrelated-provider external-ID reuse *not* colliding, payment-amount mismatch rejection, payment-currency mismatch rejection, GST line-rounding, and the deterministic reservation-exclusion case, alongside all of the original race/idempotency/rollback/access-denial coverage. All 21 pass.
- **Production-style default-privilege rehearsal, repeated for the new/changed functions specifically** (the exact defect class Stage A caught at report line 29): reset to the `20260916151000` baseline, ran `alter default privileges for role postgres in schema public/private grant execute on functions to authenticated` to mirror the hosted footgun, applied the three new/edited migrations with `supabase migration up --local --include-all`, and directly verified via `has_function_privilege` that under those hostile defaults `authenticated` still cannot execute `private.commit_sale`, `process_paid_sale_webhook`, or `private.finance_issue_locked`, while `public.commit_sale` and `public.admin_upsert_sales_channel_config` remain `authenticated`-only and `process_paid_sale_webhook` remains `service_role`-only. Re-ran the full webhook test file against this hostile-default database: all 21 tests still pass, including the ACL-denial tests. This proves the fix, not just its construction.
- **Populated upgrade rehearsal, repeated**: moved the three new/edited migrations out, reset to the `20260916151000` baseline, ran `inventory-concurrency.test.ts` and `finance-pos-finalisation.test.ts` to reproduce the exact Stage A baseline (2 products, 4 balances, 28 movements, 4 invoices, 2 payments, 1 customer — matched exactly), fingerprinted `products` and `inventory_movements` row ids by MD5, restored the three migrations and ran `supabase migration up --local --include-all`. Every row count and both fingerprints were byte-identical after the upgrade; `organizations` seeded its two rows; `sales`, `private.sales_channel_configs`, and `organization_location_assignments` were all empty immediately after upgrade (nothing auto-enrolled).
- Full gate rerun after all edits: `npm run test:integration` **380 passed, 0 failed, 0 skipped**; `npm run test:unit` **399 passed**; `npm run test:critical-coverage` **55 passed** (coverage unchanged: 91.89%/92.42%/92.30%/94.73%); `npm run typecheck` PASS; `npm run lint` PASS; `npm run build` PASS (Next.js 16.3.3, 48/48 pages); `npm audit --omit=dev` PASS, 0 vulnerabilities; `git diff --check` PASS.

### Known residual scope, stated rather than hidden

- **Product-ownership isolation is not resolved** (see item 4 above). Before this generic-sales surface is trusted for a multi-organization catalog, either an explicit `products.owner_organization_id`/`owner_location_id` assignment policy needs to be designed and populated, or the sale path needs to additionally verify the selling location's organization matches the product's own catalogued organization once that concept exists. No such data was invented here.
- **`p_actor_user_id` on the webhook path remains caller-supplied by the trusted `service_role` caller.** Because `process_paid_sale_webhook` is reachable only by `service_role`, this is not a caller-authorization gap, but it does mean automated/webhook-driven sales are currently attributed to whatever admin user id the trusted integration layer supplies in `audit_events`, not to a dedicated "system" identity. Worth a follow-up if/when a real payment adapter is built.
- **No live Stripe (or other) adapter exists.** `private.sales_channel_configs` is seeded empty; nothing is configured to accept live traffic. Configuring a real provider, verifying its webhook signature at the HTTP layer, and obtaining its actual currency/amount contract remain separate, explicitly-authorized future work, per the original instruction not to invent Stripe configuration.
- The three anon-executable trigger-only private helpers noted in the Stage A advisor scan (report line 93) remain unchanged, as before, by explicit scope decision.

### Final verdict (superseded below)

Pricing/source authorization, the payment boundary, cross-channel order identity, location-level organization isolation, and the private invoice-helper permission gap are each RESOLVED with the evidence above. Production deployment, migrations, and configuration remain unauthorized pending a decision on product-ownership scope; nothing in Stage B changes that authorization boundary.

## Stage C — product/catalog ownership model — 17 September 2026 (same day, local only)

### Decision: RELEASE READY — all five original release blockers resolved

No production deployment, migration, or configuration change occurred in Stage C. No push, merge, or commit was made. Work is one new local migration (`20260917140000_product_catalog_organization_isolation.sql`) plus expanded integration test coverage.

### Chosen model

**`public.products` is a shared reference catalogue; organization ownership begins at the location/inventory layer.** This was proven, not assumed, by reading the actual schema and RPC bodies (file:line citations below):

- `products` core columns (`name`, `category_code`, `part_reference`, tyre attributes, `active`, `retail_price_incl_gst`, `wholesale_price_incl_gst`, `selling_price_incl_gst`) carry no organization/location scope and are the intended shared catalogue (`supabase/migrations/20260902091000_product_catalog.sql:46-78`).
- Physical/financial stock state lives one layer down, keyed by `(product_id, location_id)`: `on_hand`, `reserved`, and **weighted_average_cost** all live on `public.inventory_balances`, never on `products` (`supabase/migrations/20260902092000_inventory_ledger.sql:5-15`). `inventory_movements.cost_snapshot`/`inbound_unit_cost` are likewise location-scoped, append-only ledger rows (`20260902092000_inventory_ledger.sql:17-45`).
- Each active location belongs to exactly one organization, enforced by a partial unique index on `organization_location_assignments(location_id) where active` (`supabase/migrations/20260916204935_generic_sales_webhook_organization_foundation.sql:24-33`) — the derivation `location → organization` used everywhere below is sound and cannot be spoofed.
- `products.owner_location_id` (`supabase/migrations/20260915191609_flexible_product_creation.sql:7`) is the one column that **does** carry organization affinity, and it already existed before this pass: **NULL** = shared/global catalogue entry (all 55 production products, confirmed unchanged — see Populated upgrade below); **not null** = a workspace-owned product created via `create_workspace_product`, exclusive to whichever organization owns that one location. `products_read` RLS (`20260915191609:10-13`) already hid a foreign location's workspace product from direct `SELECT`, but `private.commit_sale` is `SECURITY DEFINER` and bypasses RLS entirely — it did not re-assert this boundary itself. That was the actual, narrow gap; not the shared-catalogue model.
- Pricing is intentionally global, not organization-specific: `private.product_sale_price(product_id, tier)` (`supabase/migrations/20260914120000_retail_wholesale_pricing_walkin_regency_defaults.sql:86-99`) takes no location/organization argument and reads `products.retail_price_incl_gst`/`wholesale_price_incl_gst` directly, gated behind `inventory.edit_global_price` for writes. No `organization_product_prices` layer is needed or was invented.
- Suppliers (`supabase/migrations/20260903090000_purchasing_permissions_suppliers.sql:29-58`) are likewise global reference data (no location/org column), with `last_cost` withheld from every authenticated column-grant regardless of role. Production currently has zero supplier rows. Left unchanged — no leak found, no redesign performed.
- `inventory_reservations` (`supabase/migrations/20260905120000_phase_3b_quotes_jobs_pos.sql:132-188`) already matches by `product_id` **and** `location_id` (see `RESERVATION_INCONSISTENT` checks at lines 164 and 530), and the generic sale path in `private.commit_sale` never touches this table at all. No new interaction, no new risk; closed by citation.
- Read paths (`private.inventory_product_summary`, `supabase/migrations/20260914185720_inventory_product_summary_security_invoker.sql:35-99`; `public.inventory_summary_page`, `supabase/migrations/20260916151000_customer_returns_and_catalog_search.sql:353-420`) already filter `where app_is_admin() or location_id = app_user_location_id()` and gate cost behind `inventory.view_cost`. Since one location maps to exactly one organization, this is already effective org-scoped read isolation for every non-admin role. Regression-tested directly (see Tests below).

**Granularity mismatch, deliberate:** `products_read` RLS (`20260915191609:10-13`) scopes a workspace product's visibility to its *exact* `owner_location_id`, but `assert_product_organization_scope` (below) scopes the sale-time check to the *organization* that owns that location. A sibling location in the same organization can therefore sell a workspace product through `commit_sale` that a direct RLS `SELECT` would still hide from it. This is intentional and safe for the organization-isolation boundary this remediation covers (it can only ever be *more* permissive within one organization, never across organizations), but it is a real behavioral difference from base-table read visibility. Recorded here so a future developer does not "fix" `commit_sale` into single-location silos, or conversely loosen `products_read` RLS to match, without recognizing these are two independently-chosen boundaries for two different concerns (row visibility vs. sale authorization).

**Explicit scope statement for the next developer:** the new authorization check added below is **inert for all 55 existing production products** — every one has `owner_location_id = null`, so `assert_product_organization_scope` returns immediately for each of them. Their isolation rests entirely on the pre-existing, already-sound per-location `inventory_balances` keying (a sale at a location with no balance row, or insufficient on-hand there, fails regardless of the product's global ID). The new check only starts doing work the moment a `create_workspace_product` row exists — it closes that class of product **before** it can be populated, not the legacy 55.

### What changed

New migration `supabase/migrations/20260917140000_product_catalog_organization_isolation.sql`:

1. **`private.assert_product_organization_scope(p_product, p_organization_id)`** — new private helper, no API-role EXECUTE grant, empty `search_path`. If `p_product.owner_location_id is null` (shared/global catalogue), returns immediately — no constraint. If it is set, resolves that location's own active organization via `organization_location_assignments` and requires it match the selling organization; otherwise raises `PRODUCT_NOT_AVAILABLE_AT_LOCATION` (`42501`).
2. **`private.commit_sale`** re-created with exactly one added line per sale item — `perform private.assert_product_organization_scope(v_product, p_organization_id);` — inserted immediately after the existing product lookup and before the existing `inventory_balances` lookup/lock, so a cross-organization sale fails before any balance read, movement, or `sale_items` row. Every other line is byte-identical to `20260916204935_generic_sales_webhook_organization_foundation.sql`. Both `public.commit_sale` (staff POS) and `public.process_paid_sale_webhook` call this same private function, so both entry points are covered by one change.
3. **`public.receive_transfer` bug fix (independent finding, required to prove #2):** `20260915191609_flexible_product_creation.sql` changed `private.seed_inventory_balances` to seed a balance row only at a workspace product's own `owner_location_id` (previously every product got a zero row at every location unconditionally). `public.receive_transfer` (current version: `supabase/migrations/20260912131000_transfer_replay_hardening.sql:71-183`) was never updated for that: its destination-side `update public.inventory_balances ... where product_id=... and location_id=...` silently affects zero rows when no balance row exists yet there, while the `transfer_in` `inventory_movements` row is still inserted unconditionally — stock is debited at the source, recorded as arrived by the movement ledger, and then never credited at the destination. This is a **silent stock-loss bug**, discovered only because it blocked constructing the cross-organization attack test for item 2 (transferring a workspace-owned product to a foreign organization's location previously lost the stock entirely instead of creating a bad balance row). Fixed with a minimal, ordered `insert ... on conflict (product_id, location_id) do nothing` immediately before the existing row-locking `perform`, ensuring the destination balance row exists (zero-initialized, matching the pre-20260915191609 default) before crediting it. Every other line is unchanged from the current `20260912131000_transfer_replay_hardening.sql` body (not the superseded `20260905100000_stock_transfers.sql` one — an early draft of this fix was written against the wrong, stale copy and caught by two failing regression tests in `stock-transfers.test.ts`; corrected before commit).

### Verification performed

- `npx supabase db reset --local --yes`: all 58 migrations (including the new one) apply cleanly to a fresh database.
- **Cross-organization attack test, both directions (release requirement, item 5):** `tests/integration/generic-sales-webhook.test.ts` — *"denies selling a workspace-owned product transferred into a foreign organization's location, and allows it at its own"*. Creates a workspace product owned by AWT's location (LON), stocks it, transfers 2 units to 247TRUCK's location (REG) through the real `create_transfer_request → submit → approve → dispatch → receive` flow (proving the org-unaware transfer feature really can create a foreign-organization balance row for an owner-scoped product), then: (a) confirms REG genuinely holds `on_hand=2` for it; (b) confirms `t.reg.rpc('commit_sale', ...)` at REG is denied with `PRODUCT_NOT_AVAILABLE_AT_LOCATION` **before any row is written** (verified zero `sales` rows at REG, zero `generic_sale` movements at REG, REG balance unchanged at 2); (c) confirms the same product still sells normally at its own organization's location (LON).
- **Shared-catalogue dual-organization test:** *"lets a shared catalogue product carry stock in both organizations without merging their balances"* — a `create_product` (global, `owner_location_id null`) item stocked only at REG is correctly denied at LON with `INSUFFICIENT_STOCK` (not a bogus `BALANCE_NOT_FOUND`, since shared products are zero-seeded everywhere) and REG's balance is untouched by the attempt; once LON is independently stocked, LON's own sale succeeds and REG's balance still doesn't move; then, symmetrically, REG's own sale succeeds and LON's balance still doesn't move — proving both directions of "same global Product ID, independent organization balances," not just one.
- **Read isolation regression:** *"does not let a manager read another organization's location balance row directly"* — direct `inventory_balances` `SELECT` from a foreign-organization manager returns zero rows (pre-existing RLS, now explicitly regression-tested for this scenario).
- Full `generic-sales-webhook.test.ts` file: 24/24 pass (21 pre-existing + 3 new).
- **Populated upgrade rehearsal, scoped to just this migration:** moved `20260917140000_product_catalog_organization_isolation.sql` out, reset to the prior baseline (`20260917130000`), ran the full `generic-sales-webhook.test.ts` + `inventory-rpc.test.ts` suites to populate synthetic data (24 products, 47 balances, 49 movements, 2 customers, 0 suppliers), MD5-fingerprinted `products`, `inventory_balances`, `inventory_movements`, `customers`, `suppliers` in full plus counted `products` with `owner_location_id is null` (23 in this synthetic set — the fixture doesn't reproduce the production 55, but the invariant is the same: none of them were touched). Restored the migration file and applied it with `supabase migration up --local --include-all` (incremental, not a reset, so the populated data survives). Re-fingerprinted: **every hash and every count was byte-identical**, and the `owner_location_id is null` count was unchanged. No product, balance, or movement row was modified, backfilled, or reordered by this migration — confirmed, not assumed.
- Full gate rerun on a fresh reset: `npm run test:integration` **383 passed, 0 failed, 0 skipped**; `npm run test:unit` **399 passed** (59 files); `npm run test:critical-coverage` **55 passed** (coverage unchanged: 91.89%/92.42%/92.30%/94.73%); `npm run typecheck` PASS; `npm run lint` PASS; `npm run build` PASS (Next.js 16.3.3, 48/48 pages); `npm audit --omit=dev` PASS, 0 vulnerabilities; `git diff --check` PASS.
- **Grant check:** direct `has_function_privilege` queries against the local database confirm, under its current defaults, that `authenticated`/`anon`/`service_role` all lack EXECUTE on `private.assert_product_organization_scope` and `private.commit_sale`, and that `public.receive_transfer` is `authenticated`-only exactly as before. The Stage B **hostile-default-privilege rehearsal** itself (mirroring production's `alter default privileges ... grant execute on functions to authenticated` footgun) was **not re-run** in this pass — the command was declined by this session's own safety controls even against the disposable local database. As a mechanical substitute, `pg_proc.proacl` was inspected directly for all three touched functions and confirmed **explicitly enumerated** (`{postgres=X/postgres}` for the two private functions, `{postgres=X/postgres,authenticated=X/postgres}` for `receive_transfer`) rather than empty/inherited — i.e. each function's ACL was actually set by this migration's explicit `revoke`/`grant` statements, the same mechanism Stage B verified survives the hostile-default footgun, not left to whatever the role's default privileges happen to be. This confirms the same outcome the rehearsal checks, by inspecting the resulting ACL state directly instead of reproducing the hostile environment; the full rehearsal can still be re-run before production sign-off if a from-scratch repeat is wanted.

### A finding surfaced, not hidden: admin-authorized cross-organization cost disclosure via transfer

While proving the fix above, a cost-basis probe was run: a shared-style product stocked at LON with a distinctive inbound cost (`$137.77`), transferred via the real `create_transfer_request → approve → dispatch → receive` flow to REG. REG's own manager (granted `inventory.view_cost`), reading through the normal cost-gated `inventory_summary_page` RPC at their own location, saw `weighted_average_cost: 137.77` — LON's inbound cost, now genuinely stored in REG's own `inventory_balances` row and visible through REG's own authorized read path.

This is **not new organization-confidential leakage introduced by this migration** for the existing 55 shared products: `inventory_balances` rows already existed for them at every location before this pass, and an admin could already move stock (and its cost) between LON and REG via the pre-existing, organization-unaware transfer feature (`private.transfer_authorized`, `supabase/migrations/20260905100000_stock_transfers.sql:119-133`, has no organization check and never has). The bug fix in this migration *does* make this pathway newly **effective** for workspace-owned products specifically — before the fix, the same transfer would have silently discarded the stock and its cost (see the bug description above) rather than disclosing it.

The judgment call recorded here: this is not the threat model the release brief's cost-isolation requirement targets, and it does not block release, but it is a real behavior worth an explicit decision. The requirement (item 7) is that Org A must not retrieve Org B's cost basis *through a shared Product ID* — i.e. a query-time leak. That does not happen here: every cost-bearing read path audited in this pass (`inventory_product_summary`, `inventory_summary_page`) filters strictly by the caller's own `location_id`, so REG's manager querying the shared Product ID gets REG's own `inventory_balances` row, never LON's. What actually happened is different and, on inspection, unremarkable: **REG's own manager is reading REG's own balance row for stock REG now physically holds**, after an Admin-approved physical transfer moved that stock (and, following standard weighted-average-cost accounting, its cost basis) from LON to REG. That is the same thing that already happened for every one of the 55 shared products before this pass — `inventory_balances` rows existed for them everywhere, and an Admin could already move stock and cost between LON and REG via the pre-existing, organization-unaware transfer feature (`private.transfer_authorized`, `supabase/migrations/20260905100000_stock_transfers.sql:119-133`, no organization check, none added or removed here). This migration's bug fix only makes that same pre-existing pathway *reach its intended effect* for workspace-owned products too, instead of silently losing the stock (see the bug description above).

The open business question this surfaces — not this remediation's to answer, and not attempted here — is whether 24/7 Truck Tyre Services and Adelaide Wholesale Tyres keep separate books such that physically transferred stock between them should cross at an explicit transfer price rather than carrying its original cost basis forward, the way inter-company transfers typically work in accounting when the transferor and transferee are separate legal entities. Nothing in this repository currently establishes an answer either way: `organizations` is presently just two label rows with no accounting-boundary semantics attached. `approve_transfer` already requires `private.app_is_admin()` (`supabase/migrations/20260905100000_stock_transfers.sql:228-238`) and a non-admin manager cannot single-handedly move stock across organizations (`transfer_authorized`/`transfer_operator_authorized` additionally require the acting manager to be located at the source or destination), so this is not an authorization bypass reachable by an unprivileged caller — but "an Admin can do it" is a description of who can trigger it, not a justification for whether cost should travel that way. Recorded here for an explicit go/no-go by whoever owns that accounting decision; not fixed, not hidden, and out of scope for this migration to decide unilaterally.

### Legacy data

No `products.owner_location_id` value was assigned, guessed, or backfilled. No `inventory_balances` ownership was rewritten. No `inventory_movements` row was rewritten, reordered, or deleted. Confirmed by byte-identical fingerprints in the populated upgrade rehearsal above.

### Tests added (mapped to the 12 required in the release brief)

1. Global product, foreign-org stock only, sale denied — **covered** (workspace-owned + transfer test, `PRODUCT_NOT_AVAILABLE_AT_LOCATION`).
2. Same product stocked in A and B, Org A sale affects A only — **covered** (shared-catalogue dual-org test).
3. Same product stocked in A and B, Org B sale affects B only — **covered**: the shared-catalogue test's final step has 247TRUCK's REG manager sell from REG after AWT's LON sale, and asserts REG decrements while LON is untouched.
4. Org A cannot inspect Org B balance — **covered** (direct-read regression test).
5. Org A cannot inspect Org B reservation — **closed by citation, not a new test**: `commit_sale` never references `inventory_reservations`, and existing reservation matching already includes `location_id` (`20260905120000_phase_3b_quotes_jobs_pos.sql:164,530`). No new interaction was introduced for this migration to regress.
6. Org A cannot inspect Org B WAC/cost — **partially covered, with an explicit finding recorded above** rather than a passing/failing test: the direct-read regression test proves a **foreign** organization's balance row (and therefore its cost) is unreachable through RLS; the admin-authorized transfer pathway is a separate, documented, non-blocking finding, not a caller-side leak.
7. Org A cannot inspect Org B sale — pre-existing: `sales`/`sale_items` have zero authenticated read grant at all (`20260916204935:154-159`), verified in the existing `'keeps the new authoritative tables RPC-only...'` test.
8. Org A cannot mutate Org B sale — pre-existing, same grant fact as #7 (no authenticated write/read path exists at all).
9. Invalid product/location relationship creates zero movements — **covered** (transfer test explicitly asserts zero `generic_sale` movements at REG after the denied sale).
10. Invalid product/location relationship creates zero sale rows — **covered** (same test, zero `sales` rows at REG).
11. Concurrent sales remain isolated per location — pre-existing coverage (6+6, 2+3 racing-sale tests already exercise per-location/per-product row locking); not re-tested per-organization specifically since organization is a stable, non-racing derivation from location (`assert_organization_location_scope`), not a per-request input.
12. Shared Product ID does not merge organization inventory balances — **covered** (shared-catalogue dual-org test; `inventory_balances` primary key is `(product_id, location_id)`, structurally incapable of merging).

### Final gate totals

| Command | Result |
| --- | --- |
| `npm run test:integration` | **383 passed, 0 failed, 0 skipped**; exit 0 |
| `npm run test:unit` | **399 passed**, 59 files; exit 0 |
| `npm run test:critical-coverage` | **55 passed**; statements 91.89%, branches 92.42%, functions 92.30%, lines 94.73%; exit 0 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS; Next.js 16.3.3, 48/48 generated pages |
| `npm audit --omit=dev` | PASS; 0 vulnerabilities |
| `git diff --check` | PASS |
| Populated upgrade rehearsal | PASS — byte-identical fingerprints, zero rows touched |

### Final verdict

**RELEASE READY — all five original release blockers resolved.** Pricing/source authorization, the payment boundary, cross-channel order identity, location-level organization isolation, the private invoice-helper permission gap (Stage B), and now product/organization isolation for the shared catalogue (Stage C) are each resolved with evidence, not assumption. The shared-catalogue model was proven safe by reading the actual schema and RPC bodies, not declared safe by default. One narrow gap (workspace-owned products bypassing organization scope inside a `SECURITY DEFINER` function) was found and closed without touching any of the 55 existing production products, which remain provably untouched. One independent, pre-existing stock-loss bug in `receive_transfer` was found and fixed because it blocked verifying the isolation fix. One non-blocking finding (admin-authorized cross-organization cost disclosure via transfer, pre-existing for shared products, now also effective for workspace-owned ones) is recorded explicitly above for a business decision, not silently accepted or silently fixed.

Production deployment, migrations, and configuration remain **not authorized by this document**. Per the Release configuration section above: obtain explicit production authorization, take a verified logical backup, and apply migrations in the established order (`20260916155821` → `20260916204935` → `20260917130000` → `20260917140000`) with schema/grants/reconciliation verification after each, before any of this reaches production. Never create fake sales/invoices or move real stock for smoke testing.

> **SUPERSEDED.** This authorization boundary held through Stage C. It was subsequently lifted by explicit, separate user authorization: the four migrations listed above were applied to production, followed by two further reviewed migrations (`20260917150000`, `20260917160000`) covering the shared-REG multi-organization model and strict multi-brand transaction authorization. The application was then deployed to production. See Stage D below for the full record.

## Stage D — final production deployment status — 17 September 2026 (same day)

### Decision: PRODUCTION DEPLOYED — RELEASE READY

This section records the actual, verified end state of production after all remediation in Stages A–C, two additional reviewed migrations, and a completed application deployment. Unlike Stages A–C, this section describes **production**, not local-only work. All facts below were confirmed by direct read-only inspection of the live `247truck` Supabase project and the live Vercel deployment; no fact here is inferred or assumed.

#### Production Supabase

- Project `247truck`, ref `afefdlvepdbtaxoscwew`, region `ap-southeast-2`, status `ACTIVE_HEALTHY`.
- Migration registry: **60 migrations**, local == remote for all, **zero mismatches, zero duplicate versions, zero orphan versions, no timestamp drift**. Latest applied: `20260917160000_pos_business_brand_selection`.
- The migration-version drift referenced earlier in this document's history (registry repair via the official Supabase CLI, not a raw `UPDATE` against `supabase_migrations.schema_migrations`) remains accurate historical record and is not restated here.

#### Two additional migrations beyond Stage C, both now applied and verified

1. **`20260917150000_shared_location_multi_organization_sales`** — established the shared-REG multi-organization architecture described below. Dropped the one-active-organization-per-location unique index (superseding the Stage C assumption, restated below); redefined `admin_assign_organization_location` to permit multiple simultaneously active organizations per location; replaced `public.commit_sale`'s location-derived-organization signature with an explicit `(p_request_id, p_organization_id, p_location_id, p_items)` signature authorized via `private.assert_organization_location_scope`.
2. **`20260917160000_pos_business_brand_selection`** — introduced strict, organization-backed multi-brand transaction authorization (`private.transaction_brand_guard`, described below), applied to POS sales and job-to-invoice completion. This closed a real gap found in post-Stage-C review: a stock-consuming job/invoice transaction at a zero-organization location could previously fall through to a legacy location-code brand default, letting a caller with only location/stock permissions complete a job and issue a branded invoice with no business identity ever configured for that location. That gap is now closed; see "Final multi-brand transaction security" below.

> **Correction to a Stage C statement.** Stage C's "Chosen model" section states: "Each active location belongs to exactly one organization, enforced by a partial unique index on `organization_location_assignments(location_id) where active`." **This is no longer true and should be read as historical.** `20260917150000` deliberately dropped that constraint because REG/Regency Park is a real, single physical warehouse that both 24/7 Truck Tyre Services and Adelaide Wholesale Tyres legitimately trade from simultaneously — "one location, one organization" was the wrong invariant for this business, not a bug. The correct, current invariant is: **a location may have zero, one, or many simultaneously active organizations; business identity is authorized per-transaction via `private.transaction_brand_guard`, never inferred from location alone.**

#### Final shared-REG business model

- **REG / Regency Park = one real physical inventory pool.** `247TRUCK` and `AWT` are both authorized business identities at REG. Inventory remains keyed to physical location (`inventory_balances` primary key `(product_id, location_id)`, unchanged); business identity is a separate, orthogonal concern from physical inventory location. No organization-specific inventory balance split exists or is required.
- **LON / Lonsdale = legacy/unverified, zero active organization assignments.** LON must not be used as a transaction business boundary. LON is **not** AWT's location by any current data or code path — any earlier document text implying "LON = AWT" (e.g. this document's own Stage B/C narrative describing AWT-owned workspace products created at LON as a *test fixture convenience*, not a business rule) refers to local test setup, not a production invariant, and should not be read as current architecture.
- Current production assignments, confirmed by direct query: `247TRUCK → REG` active, `AWT → REG` active. **REG active organization count: 2. LON active organization count: 0.**

#### Final multi-brand transaction security

Production contains `private.transaction_brand_guard(p_brand text, p_location_id uuid)`. The old helper `private.pos_brand_guard` no longer exists under that name (confirmed absent from `pg_proc`). `transaction_brand_guard` is **not** directly executable by `anon`, `authenticated`, `service_role`, or `PUBLIC` — it is used internally only by reviewed `SECURITY DEFINER` wrapper functions.

Strict transaction business authorization now applies to all four business-affecting, stock-consuming entry points: `public.finalise_pos_sale`, `public.finalise_pos_sale_with_brand`, `public.complete_job_and_create_invoice`, `public.complete_job_and_create_invoice_with_brand`. Verified behavior, by both local integration tests (12 tests in `tests/integration/job-invoice-business-scope.test.ts`, plus the pre-existing POS-focused suite) and production function-definition inspection:

| Location | Selected business | Result |
| --- | --- | --- |
| REG | `247` | allowed |
| REG | `awt` | allowed |
| REG | none | `BUSINESS_SELECTION_REQUIRED` |
| REG | unauthorized/arbitrary | `ACCESS_DENIED` |
| LON | `247` | `BUSINESS_NOT_CONFIGURED` |
| LON | `awt` | `BUSINESS_NOT_CONFIGURED` |
| LON | none | `BUSINESS_NOT_CONFIGURED` |

The legacy location-code fallback (`private.invoice_brand_guard`'s LON→`awt` default) can no longer establish business identity for a stock-consuming POS/job transaction. It remains intact and correct for its narrower original purpose — manual invoice creation and job-to-invoice creation that do **not** consume stock — and was deliberately not removed.

Business authorization (`transaction_brand_guard`) runs **before** `finance_request` (the durable idempotency write), job completion, inventory mutation, and invoice creation, in all four entry points — confirmed both by local guard-before-idempotency-write and cross-entrypoint idempotency tests, and by direct `pg_get_functiondef` position inspection against the live production function bodies. A rejected business selection therefore creates zero transaction side effects (verified: unchanged on-hand, job status, inventory movement count, invoice count, and payment count).

#### Public RPC ACL state

`finalise_pos_sale`, `finalise_pos_sale_with_brand`, `complete_job_and_create_invoice`, `complete_job_and_create_invoice_with_brand`, `pos_business_options`, `invoice_brand_options` are all `authenticated`-only in production (`anon = false`, `service_role = false`, `PUBLIC = false`). Authenticated execution of these intended public `SECURITY DEFINER` entry points is expected by design — each performs its own internal actor/location/business authorization before mutating anything — and is not itself a regression; it is the same posture already documented as INTENTIONAL for the wider set of RLS-enabled/no-direct-policy tables and RPC-only tables earlier in this document.

#### Provider configuration — correction to an earlier report in this deployment's history

An earlier verification pass in this rollout incorrectly reported "`sales_channel_configs` does not exist" by checking the `public` schema only. **Corrected, authoritative state:** `private.sales_channel_configs` **exists** (created by `20260916204935_generic_sales_webhook_organization_foundation`, described in Stage B above) and contains **0 rows**. `public.sales_channel_configs` does not exist and was never intended to — the table is deliberately private-schema-only, per the Stage B payment-boundary design.

No provider is configured: no Stripe provider, no AWT website provider, no 247 website provider, no checkout provider, no paid-sale webhook configuration. `public.process_paid_sale_webhook` remains fail-closed, confirmed by direct inspection of its live production definition: it queries `private.sales_channel_configs` for an active matching provider **before persisting any row**, and with zero configured rows, any provider name raises `UNKNOWN_PROVIDER` (errcode `42501`). External website payment/provider integration is **not** complete and is not described as complete anywhere in this section — it remains separate future scope (see "Remaining non-blocking future work" below).

#### Final production data state (read-only verification, no writes)

| Metric | Value |
| --- | --- |
| Products | 55 |
| Inventory balances | 110 |
| Inventory movements | 80 |
| Total on-hand | 641 |
| Sales | 0 |
| Jobs | 1 |
| Invoices | 4 |
| Payments | 0 |
| Adelaide reservations | 2 |
| Organization assignments (active, at REG) | 2 |
| `private.sales_channel_configs` rows | 0 |
| Ledger reconciliation discrepancies | 0 |
| Negative on-hand | 0 |
| Reserved > on-hand | 0 |

These values were captured identically before the `20260917160000` migration, immediately after the migration, and again after the application deployment — **no production business data changed as a side effect of either the migration or the deployment.** This mirrors, and extends to production, the same byte-identical-fingerprint discipline already used for every local populated-upgrade rehearsal earlier in this document.

#### Production application deployment

- Release branch `fix/inventory-branch-safety-ci`, final release commit `de1df7a` (building on this document's Stage B/C commit lineage: `465bb5f`, `b828f4a`, `aee6a87`, `652a022`, `15ad966`, `79656de`, `46e55ac`, `c2f4da0`, `f45a180`, `de1df7a`).
- Merged to `main` via PR #28; `main` merge commit `b48c23d`.
- Deployment mechanism: Vercel Git integration (production branch = `main`) — this is the repository's pre-existing, established deployment mechanism; no new hosting service, deploy platform, or proxy was introduced.
- Production deployment `dpl_7xgFjkyeCHbgrNtmnJR5xePC8CWP`, status **Ready**, live at `https://247trucktyreservices.store`, confirmed running `main` containing `de1df7a`. The deployment includes the new multi-brand Business-selection application code (POS business selector; job-invoice organization-scoped brand handling).

#### Production smoke verification

`https://247trucktyreservices.store/login` returns HTTP 200 and renders a working staff sign-in form. Unauthenticated `/pos` and `/api/sales/business-options` correctly redirect (307) to `/login` rather than returning a 500 or a missing-RPC error, confirming the deployed routes build correctly against the new production RPC signatures. Source inspection confirms the deployed POS action calls `finalise_pos_sale_with_brand` and job invoicing calls `complete_job_and_create_invoice_with_brand`; no runtime reference to the retired `pos_brand_guard` name remains anywhere in the application source.

**Verification limitation, stated explicitly rather than glossed over:** authenticated POS Business-selector rendering was **not** manually verified — no authenticated browser session or credentials were available in this environment, and none were created for this purpose. This is a known, explicit gap, not a passed test; see "Remaining non-blocking future work" below.

#### Security and data preservation

The rollout preserved, byte-for-byte: products, inventory balances, inventory movements, on-hand, sales, jobs, invoices, payments, Adelaide reservations, and organization assignments. Migration `20260917160000` created no business data; the application deployment created no business data. Supabase security advisors report **0 ERROR-level findings**. The three WARN-level findings present are the expected "authenticated can execute this SECURITY DEFINER function" advisories for the six intended public entry points listed above — non-blocking, by design, consistent with this document's existing advisor classification convention (see "Supabase advisors" table above).

#### Release blocker status — final

| Item | Status |
| --- | --- |
| Customer-return replay identity | RESOLVED (Stage B) |
| Pricing/sale-source authority | RESOLVED (Stage B) |
| Payment trust boundary | RESOLVED (Stage B, fail-closed boundary; live provider integration remains future scope) |
| Cross-channel external-order identity | RESOLVED (Stage B) |
| Organization/location authorization | RESOLVED (Stage B location scope; Stage C product/catalog scope) |
| Private finance helper EXECUTE hardening | RESOLVED (Stage B) |
| Product/catalog organization isolation | RESOLVED (Stage C) |
| Shared-REG multi-organization architecture | RESOLVED (`20260917150000`, this stage) |
| Multi-brand POS business selection | RESOLVED (`20260917160000`, this stage) |
| Zero-organization fail-closed behavior | RESOLVED (`20260917160000`, this stage) |
| Job/invoice stock-consuming business scope | RESOLVED (`20260917160000`, this stage) |

All items above are RESOLVED, verified, and **deployed to production** — not merely implemented locally.

#### Remaining non-blocking future work

These are explicitly out of scope for, and do not reopen, the completed multi-brand inventory/POS/job deployment:

1. Authenticated human acceptance test of the POS Business selector (see verification limitation above).
2. Website/payment provider configuration (Stripe or otherwise) — `private.sales_channel_configs` remains intentionally empty.
3. Website paid-sale/webhook integration against a real provider.
4. The known unmapped Adelaide catalog item, `greforce-g-pilot-x1-29580r225` (see Stage A "Adelaide mapping" above) — still unmapped, still non-blocking for the same reason stated there.
5. The admin-authorized cross-organization WAC transfer-cost-basis accounting-policy decision recorded in Stage C ("A finding surfaced, not hidden") — still an open business question for whoever owns that decision, not an authorization bypass, not addressed by this stage.

### Final verdict

**PRODUCTION DEPLOYED — RELEASE READY.** All eleven items in the release blocker table above are resolved, verified against production directly (not only locally), and live. Stages A through C's local-only "RELEASE READY, not yet authorized" posture is superseded: production deployment did occur, under explicit separate user authorization, following the same rigor established throughout this document — read-only verification before every write, populated-upgrade rehearsals proving byte-identical data preservation, ACL verification via `has_function_privilege`, and function-definition inspection in place of any real production transaction for testing. External website payment/provider integration is explicitly **not** claimed complete anywhere in this document; it remains separate, future, non-blocking scope.
