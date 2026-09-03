# 24/7 Inventory Phase 1 Progress

## Scope and safety

- Branch: `feat/inventory-phase-1`
- Worktree: `C:\Users\abuba\.config\superpowers\worktrees\247truck\feat-inventory-phase-1`
- Separate inventory Supabase project only.
- Never reset or delete a production database.
- Later security-definer functions must set `search_path = ''` and use explicit grants.
- No push, merge, deployment, or production database access in this phase.

## Baseline

- Starting worktree status: clean; branch `feat/inventory-phase-1` tracking `origin/main`.
- Existing public-app baseline supplied and accepted: 41 tests passed, 1 database test skipped; lint, typecheck, and build passed.
- Runtime confirmed: Node.js `v22.23.1`; npm `10.9.8`.

## Task 1 - Scaffold the separate inventory app

Status: complete - implemented, verified, committed, and review-approved.

### RED

- Command: `npm run test:unit -- app-config.test.ts`
- Result: failed as expected before implementation. Vitest reported `Failed to resolve import "../../lib/app-config"` because `lib/app-config.ts` did not exist.

### GREEN and verification

- Initial GREEN command: `npm run test:unit -- app-config.test.ts` - 1 test passed.
- Final gates: `npm run test:unit`; `npm run typecheck`; `npm run lint`; `npm run build` - all passed without errors or warnings.
- Asset verification: both inventory brand asset SHA-256 hashes match their public-app sources byte-for-byte.
- Artifact verification: `node_modules`, `.next`, `next-env.d.ts`, and generated test/build output are ignored and absent from Git status.
- shadcn/ui: non-interactive initialization and component generation succeeded. The current `base-nova` registry silently omitted `form`; `components/ui/form.tsx` was added as the allowed manual equivalent with its direct dependencies.
- Files: standalone package/configuration, root layout, manifest, compact internal styles, app constants, unit tests and setup, shadcn configuration/components, exact brand copies, lockfile, nested ignore file, root tooling-isolation configuration, and this ledger.
- Task 1 commit: current commit (`feat(inventory): scaffold standalone app`).
- Reviews: self-review completed for completeness, scope, test quality, and public-app boundary. Spec re-review approved the corrected implementation and ledger with zero remaining issues. Quality re-review approved the tooling-isolation and Vitest fixes with zero remaining issues.

### Quality review corrections

- Root tooling boundary: quality review found the root TypeScript and ESLint configurations included the nested inventory app and its generated output. Root `tsconfig.json` now excludes `inventory-app`, and root ESLint globally ignores `inventory-app/**`; no public runtime code changed.
- Vitest RED 1: `npm run test:unit -- button.test.tsx` failed with `Failed to resolve import "@/components/ui/button"`, proving the missing alias.
- Vitest RED 2: after adding only the ESM-safe `@` alias, the same command failed with `Invalid Chai property: toBeInTheDocument`, proving the missing jest-dom setup.
- Vitest GREEN: registered `tests/setup.ts`, importing `@testing-library/jest-dom/vitest`; the focused command then passed 2 tests across 2 files.
- Inventory re-verification: `npm run test:unit` passed 2 tests; `npm run typecheck`, `npm run lint`, and `npm run build` passed without errors or warnings.
- Root boundary verification after the inventory build: `npm run lint` and `npm run typecheck` passed; `npm test` passed 41 tests with 1 database test skipped; `npm run build` passed all 27 generated routes.

## Task 2 - Locations, roles, permissions, audit, and RLS

Status: complete - implemented, verified against local disposable Supabase, reviewed, fixed, committed.

### Environment

- Local disposable Supabase stack only (`project_id = 247truck-inventory`, `linked_project: null`, DB on `127.0.0.1:54332`). No remote link, no production access.
- Docker Desktop running; `supabase` CLI 2.116.0.

### RED / GREEN

- `npm run test:unit -- permissions.test.ts` was authored first against absent `lib/auth/*` (RED recorded by previous session).
- After implementation: `npm run test:unit` 4 passed; `npm run test:integration -- access-rls.test.ts` 9 passed against `supabase db reset` schema.
- `npm run typecheck`, `npm run lint` clean.

### Deliverables

- `supabase/config.toml` (local-only, auth invite-only), `supabase/seed.sql` (empty; locations seeded in migration), `supabase/migrations/20260902090000_identity_access.sql`.
- Tables `locations`, `user_profiles`, `manager_permissions`, `audit_events`; helpers `private.app_is_admin()`, `private.app_user_location_id()`, `private.app_has_permission(text)`, `public.app_audit_event(...)`.
- `lib/auth/types.ts` (`UserRole`, `PermissionKey`, `UserAccessContext`), `lib/auth/permissions.ts` (`hasPermission`).
- `tests/unit/permissions.test.ts`, `tests/integration/access-rls.test.ts` (branch RLS isolation, cross-branch read denial, audit immutability incl. service_role, manager audit-forgery denial, inactive-profile/location lockout, authenticated write denial on identity tables, REG-vs-LON symmetry).

### Independent reviews

- Spec-compliance/security review: no Critical. Important I1 (admin audit allow-list too narrow for Phase 1 events e.g. `MANAGER_INVITED`), I2 (open sign-up), I3 (helpers relocated to `private` vs plan's `public` - kept as correct Supabase practice, deviation noted here).
- Code-quality review: no Critical. Important: dead `role='admin'` clause in `user_profiles` policy, permission-key list duplicated 3x, discriminated-union modelling suggestion, open sign-up, error-code inconsistency.

### Fixes applied before commit

- `app_audit_event` admin path now accepts any non-blank event type (actor still derived from `auth.uid()`, location still validated) - closes the service-role audit bypass seam (I1).
- `enable_signup = false` in both `[auth]` and `[auth.email]`; provisioning is invite/admin-API only (I2).
- Removed dead `role='admin'` branch from `user_profiles_select_access`.
- `private.app_has_permission` no longer re-lists permission keys (the `manager_permissions` CHECK is the single source); TS `PermissionKey` + SQL CHECK remain the two authoritative lists.
- Added `before truncate` statement trigger on `audit_events` (defense-in-depth, M1).
- Aligned `config.toml` auth URLs to `http://localhost:3100` to match `.env.example` / Playwright.
- `.env.example` documents `SUPABASE_TEST_ALLOW_DESTRUCTIVE` (integration tests refuse to run without it).

### Accepted deviations

- Helpers `app_is_admin` / `app_user_location_id` / `app_has_permission` live in schema `private` (not exposed via PostgREST), not `public` as the plan's interface list implied. Later tasks must read tables via RLS rather than `client.rpc(...)` for these. `app_audit_event` remains in `public`.
- `UserAccessContext` keeps the plan-specified flat shape (`locationId: string | null`) rather than a discriminated union; the DB `user_profiles_role_location_check` enforces the admin/manager invariant.

### Task 2 commit

- `feat(inventory): add roles locations permissions and audit` (commit `2e27fe2`).

## Task 3 - Supabase sessions, login, Manager invitations, fixed location scope

Status: complete - implemented, verified against local disposable Supabase, reviewed twice, fixed, committed.

### RED / GREEN

- RED: `npm run test:unit -- access-context.test.ts location-scope.test.ts` failed on missing modules.
- GREEN + gates: `npm run test:unit` 18 passed; `npm run test:integration` 9 passed (Task 2 RLS suite still green under the added `PASSWORD_SET` self-event); `npm run typecheck`, `npm run lint`, `npm run build` all clean (10 routes + Proxy).

### Deliverables

- Supabase clients: `lib/supabase/{env,browser,server,service,proxy}.ts`; root `proxy.ts` (Next 16 convention, Node runtime) refreshing sessions.
- Access: `lib/auth/access-context.ts` (pure `mapAccessContext`, validates location code + permission keys), `lib/auth/access.ts` (`getCurrentAccess`, redirect-on-reject), `lib/auth/audit.ts` (`recordAuditEvent` via `app_audit_event`), `lib/auth/permission-keys.ts`.
- Location scope: `lib/location/{scope.ts (pure resolveLocationScope), cookie.ts, resolve-scope.ts}`.
- Auth routes/pages: `app/(auth)/login/{page,actions}` (login + logout + password-reset request), `app/(auth)/auth/callback/route.ts` (invite/recovery code exchange), `app/(auth)/auth/signout/route.ts`, `app/(auth)/onboarding/set-password/{page,actions}`.
- Protected: `app/(protected)/{layout,actions (Admin scope cookie)}`, `app/(protected)/dashboard/page.tsx` (placeholder for Task 4), `app/(protected)/settings/users/{page,actions}` + `components/settings/{invite-manager-form,manager-access-toggle}.tsx`.
- `scripts/bootstrap-admin.ts`; `app/page.tsx` root redirect.
- Tests: `tests/unit/{access-context,location-scope}.test.ts`; `tests/load-env.ts` (dotenv loader for the test runner) wired into `vitest.config.ts`.
- Dependency added: `server-only@0.0.1`.

### Independent reviews + fixes applied

- Redirect loop (security review, Important): a disabled/mis-configured but authenticated user bounced between `/login` and `/dashboard`. Removed the authed->`/login`->`/dashboard` bounce from `updateSession`; disabled users now land on `/login` and can sign out. Redirect responses now carry rotated auth cookies.
- Invite flow non-transactional (code-quality Critical + security I3): added `findAuthUserIdByEmail` pre-check so a rollback can never delete a live account; `persistManagerProfile` helper does checked compensation (profile + permissions + Auth user) and reports orphaned Auth users needing manual cleanup; `recordAuditEvent` result is checked and surfaced in the success message; `redirectTo` now points at `/auth/callback`.
- Password set + reset (spec section 4, both reviews I2): added the invite/recovery `/auth/callback` code exchange, `/onboarding/set-password`, and "Forgot password?" on the login page (`resetPasswordForEmail`, always-generic response, no user enumeration). Manager self-audit widened to `LOGIN_SUCCESS` + `PASSWORD_SET` in the Task 2 migration.
- Unvalidated casts (both reviews, Important): `mapAccessContext` now rejects unknown location codes (`UNKNOWN_LOCATION_CODE`) and silently drops non-grantable permission keys; shared `isLocationCode` / `LOCATION_NAMES` in `app-config.ts`.
- Silent DB-error swallow in users page: both list queries now check `error` and render a failure state; query filters `role = 'manager'` server-side.
- Removed dead `getOptionalAccess`; `getCurrentAccess` skips the `manager_permissions` fetch for Admins; rejection path now logs which invariant tripped.
- `setManagerActiveAction` wired into the Users page (Disable/Enable) - satisfies spec section 4 and removes the "dead code" flag.
- `z.string().email()` -> `z.email()` (deprecated API).
- Added unit cases: array-shaped join, unknown code, unknown role, Admin ignores permission rows, non-grantable key dropped.

### Accepted / deferred

- `app/(protected)/actions.ts::setLocationScopeAction` + `parseLocationScopeRequest` have no caller yet - Task 4 wires the Admin scope selector.
- Login rate limiting relies on Supabase Auth's built-in throttling for Phase 1 (spec section 40); no app-level lockout.
- No integration test for `getCurrentAccess` / proxy / invite rollback - only unit tests were mandated for Task 3; E2E in Task 8 covers the runtime flow.
- Task 2 migration file edited in place (manager self-audit event list) rather than via a new migration - the branch is unreleased and local-only.

### Task 3 commit

- `feat(inventory): add login access context and manager invitations` (commit `52900c3`).

## Task 4 - Responsive desktop/mobile app shell

Status: complete - implemented, verified, reviewed twice, fixed, committed.

### RED / GREEN

- RED: `npm run test:unit -- shell-navigation.test.tsx` failed on missing components.
- GREEN + gates: `npm run test:unit` 28 passed; `npm run test:integration` 9 passed; `npm run typecheck`, `npm run lint`, `npm run build` clean.

### Deliverables

- `components/shell/{nav.ts (single nav descriptor list), nav-link.tsx (client active-route leaf), app-shell.tsx (server), desktop-sidebar.tsx (server, sticky), mobile-nav.tsx (client, shadcn Sheet), topbar.tsx (server)}`.
- `components/location/location-scope-select.tsx` (Admin controlled select + error surface; Manager fixed text).
- `app/(protected)/layout.tsx` renders `AppShell`; `app/(protected)/dashboard/page.tsx` real placeholder inside the shell.
- `lib/auth/permissions.ts`: `AccessSnapshot` + `toAccessSnapshot` (RSC->client serialisation of the permission Set).
- `tests/unit/shell-navigation.test.tsx` (desktop + mobile nav, permission gating, aria-current, scope select, pure nav selectors); `tests/stubs/server-only.ts` + vitest alias; `cleanup()` in `tests/setup.ts`.

### Independent reviews + fixes applied

- Mobile "More" a11y (both reviews, Important): replaced the hand-rolled backdrop modal with the generated shadcn `Sheet` (role=dialog, focus trap, Escape, restore-focus); trigger is a real button.
- Scope select error handling (both, Important): now a controlled `<select>` with `try/catch`, an inline `role="alert"` message, and revert-on-failure.
- Nav model dedup (both, Important): one `NAV_ITEMS` descriptor list with `placement` + `mobileLabel`; `primaryNavItems` / `bottomBarItems` / `moreNavItems` derive from it, so bar/more can't drift.
- Dashboard double-fetch (both, Important): `getCurrentAccess` and `getCurrentLocationScope` wrapped in React `cache()` - layout and page share one profile lookup.
- iOS safe-area: bottom nav + sheet use `pb-[env(safe-area-inset-bottom)]`.
- Sidebar/topbar now `sticky` with `h-dvh`/`overflow-y-auto` (matches "fixed sidebar" intent).
- `AppShell` reverted to a server component; only `NavLink` and `MobileNav` are client. Logo `alt=""` (was double-announced). Sign-out uses `logoutAction`.

### Accepted / deferred

- Global search and a full user menu (spec section 6) are deferred beyond Phase 1; the shell exposes only scope + notifications icon + sign out.
- `AppShell` server-rendering means per-request nav is not in the client bundle; `NavLink` is the only client nav code.

### Task 4 commit

- `feat(inventory): add responsive desktop and mobile shell` (commit `ab688e8`).

## Task 5 - Product catalogue and used-tyre data model

Status: complete - implemented, verified, reviewed twice, fixed, committed.

### RED / GREEN

- RED: `npm run test:unit -- product-validation.test.ts` failed on missing module.
- GREEN + gates: `npm run test:unit` 39 passed; `npm run test:integration` 16 passed (9 access-rls + 7 product-rls); `npm run typecheck`, `npm run lint`, `npm run build` clean.

### Deliverables

- `supabase/migrations/20260902091000_product_catalog.sql`: `product_categories` (9 approved codes seeded), `tyre_brands` / `tyre_patterns` / `tyre_sizes` (normalised, unique), `products` (single global GST-inclusive price; truck-tyre + tyre-consistency CHECK constraints), `used_tyre_units` (SELECT-only for authenticated; no insert path), `inventory_settings` (per-location, zero-filled by trigger on product insert). RPCs `public.create_product` / `public.set_product_active` (SECURITY DEFINER, `app_is_admin()` gated, ON CONFLICT upserts, atomic audit). `updated_at` touch triggers.
- `lib/products/{types.ts (codes + labels), validation.ts (Zod, empty-input-rejecting numbers), repository.ts (list/get + RPC wrappers)}`.
- `lib/format.ts` (shared `formatAud` / `formatTyreMeta`).
- `app/(protected)/inventory/{page.tsx (filters), actions.ts, new/page.tsx, [productId]/page.tsx}`; `components/inventory/{product-form.tsx, product-table.tsx, archive-toggle.tsx}`.
- `tests/unit/product-validation.test.ts`; `tests/integration/product-rls.test.ts` + `tests/integration/support/fixtures.ts` (shared tenant fixture).

### Independent reviews + fixes applied

- Dead write policies / `createProduct` unauthorised + non-transactional + upsert race (both reviews, Important): replaced the service-role `createProduct` + dead `products_admin_insert/update` policies with a single `public.create_product` SECURITY DEFINER RPC that re-checks Admin, upserts lookups with `ON CONFLICT`, inserts product, and writes the audit row in one transaction. Direct table writes have no authenticated grant - "a Manager cannot write products" is now enforced at the grant layer and genuinely tested (Manager `create_product` -> `ACCESS_DENIED`; Admin succeeds; direct INSERT blocked for every role).
- `$0` price coercion footgun (code review, Important): `requiredNumber` preprocess rejects `''` / blank / null / undefined instead of `Number('') === 0`; applied to price, tread depth, cost basis. New unit tests cover it.
- `fieldErrors` now rendered under the form error; category codes replaced with `PRODUCT_CATEGORY_LABELS` in the table; raw DB errors now `console.error`-logged before the friendly rethrow.
- Archive path added (spec + both reviews): `set_product_active` RPC + `ArchiveToggle` on the Admin product detail page (`PRODUCT_ARCHIVED` / `PRODUCT_UNARCHIVED` audit).
- LIKE-escape the search term (`escapeLike`, handles `\ % _`); `searchParams` typed `string | string[] | undefined`; `inventory_settings_admin_write` dead policy removed (Task 7 adds the write path); fixtures cleanup uses `allSettled` per user; `updated_at` touch triggers added.

### Accepted / deferred

- Brand / size filter controls and brand/pattern/size free-text search are deferred to Task 7's `searchInventory` (plan Task 7 Step 6).
- Reference tables (`product_categories`, `tyre_*`) are readable by any authenticated bearer (not gated on an active profile) - low-sensitivity catalogue reference data.
- `seed_inventory_settings` fans out over all locations without an `active` filter (both are active in Phase 1; avoids a missing-row bug if a branch is toggled).

### Task 5 commit

- `feat(inventory): add product and tyre catalogue` (commit `8f47ef4`).

## Task 6 - Atomic inventory ledger, WAC, no-negative stock, used-tyre intake

Status: complete - implemented, verified, reviewed twice (incl. a dedicated security/concurrency pass), fixed, committed.

### RED / GREEN

- RED: `npm run test:integration -- inventory-rpc.test.ts` failed on the missing RPC.
- GREEN + gates: `npm run test:integration` 28 passed (WAC/idempotency sequence, looped concurrency race + ledger reconciliation, direction guard, used-tyre atomic intake); `npm run test:unit` 39; `npm run typecheck`, `npm run lint`, `npm run build` clean.

### Deliverables

- `supabase/migrations/20260902092000_inventory_ledger.sql`: `inventory_balances` (`on_hand >= 0`, `reserved <= on_hand`, per-location WAC), `inventory_movements` (append-only trigger incl. TRUNCATE guard, `request_id` unique, direction CHECK). RPCs `post_inventory_movement`, `set_inventory_count`, `create_used_tyre_unit_with_stock` - all SECURITY DEFINER, `search_path=''`, `authenticated`-only, `FOR UPDATE` row lock, DB-enforced no-negative stock, `request_id` idempotency, atomic audit write.
- `lib/inventory/{types.ts, errors.ts (sentinel -> friendly), repository.ts (RPC wrappers + `getInventoryBalance`)}`.
- `tests/integration/{inventory-rpc, inventory-concurrency, used-tyre-intake}.test.ts`.

### Independent reviews + fixes applied

- **CRITICAL (security review C1)**: `movement_type` and the sign of `quantity_delta` were not cross-validated - a Manager with only `inventory.stock_out` could pass `stock_out` + `+50` and inflate stock/value from nothing with no reason. Fixed with an `inventory_movements_direction_check` table constraint AND an in-function `INVALID_MOVEMENT_DIRECTION` guard (inbound types must be `> 0`, outbound `< 0`, only `adjustment` may go either way). New tests cover both directions.
- Idempotency contract (security review I1/I2/I3): `post_inventory_movement` now catches `unique_violation` on the movement insert and returns the committed balance instead of a raw error; `set_inventory_count` gained a `request_id` pre-check; `create_used_tyre_unit_with_stock` replay now returns the already-created unit + movement instead of raising `DUPLICATE_REQUEST`.
- `service_role` write grants on `inventory_balances` / `inventory_movements` revoked (I6) - SELECT only; every write goes through the SECURITY DEFINER RPCs.
- Concurrency test hardened (I5): 12 repeated rounds with a fresh balance each round + a ledger-reconciliation assertion (`on_hand == sum(quantity_delta)`).
- `errors.ts` completed with the `INVALID_*` / `INVALID_MOVEMENT_DIRECTION` sentinels and an exact-match-first lookup; `InventoryError` is a proper named class; server error logs retained.
- Append-only movements TRUNCATE guard added (M1).

### Accepted / deferred

- Post-unit-insert rollback of `create_used_tyre_unit_with_stock` is guaranteed by plpgsql single-transaction semantics (no exception handler between the unit insert and the movement call); the reachable pre-insert guard failures (`NOT_A_USED_TYRE`, `ACCESS_DENIED`) are tested to leave nothing behind. A test that injects a post-insert movement failure is not feasible without a test-only hook.
- Adjustment notes are folded into the movement `reason` text (no separate movement column in Phase 1).
- Integration tests are scoped by `product_id` / `request_id`; the append-only ledger means `npx supabase db reset` before the suite gives a clean slate (documented in the test files and the plan's Task 6 steps).
- `assert_stock_authorization` reads `profile.location_id` directly; branch-inactive denial still holds because `app_has_permission` joins `locations.active`.

### Task 6 commit

- `feat(inventory): add atomic stock ledger and weighted cost` (commit `70955ec`).

## Task 7 - Stock In/Out/Adjust, used-tyre intake, inventory search, low-stock UI

Status: complete - implemented, verified, reviewed twice, fixed, committed.

### RED / GREEN

- RED: `npm run test:unit -- stock-validation low-stock` failed on the missing modules.
- GREEN + gates: `npm run test:unit` 63 passed; `npm run test:integration` 33 passed; `npm run typecheck`, `npm run lint`, `npm run build` clean.

### Deliverables

- `supabase/migrations/20260902093000_inventory_summary.sql`: `inventory_product_summary` view (`security_invoker=true`; WAC column null unless the caller holds `inventory.view_cost`), `inventory_value_for_scope(text)` RPC (gated on `reports.view_inventory_value`), `set_reorder_settings(...)` RPC (Admin-only, audited), `updated_at` touch triggers, movement index.
- `lib/inventory/{validation.ts (Zod: blank-rejecting numbers, stock-out reasons), queries.ts (searchInventory + getDashboardInventoryMetrics), low-stock.ts (isLowStock / reorderSuggestion), target-location.ts (Manager branch pin), stock-page-data.ts}`; `lib/action-result.ts`.
- `app/(protected)/stock/actions.ts` (stockIn/stockOut/adjust/usedTyreIntake/updateReorderSettings); `app/(protected)/stock/{in,out,adjust,used-intake}/page.tsx`.
- `components/stock/{product-picker.tsx, stock-form.tsx}`; `components/inventory/{inventory-view.tsx, reorder-settings-form.tsx}`.
- Rebuilt `inventory/page.tsx` (search + low-stock filter), `inventory/[productId]/page.tsx` (per-branch stock, reorder form, action links), `dashboard/page.tsx` (metrics + recent movements).
- Tests: `tests/unit/{stock-validation, low-stock, stock-form, target-location}.test.ts`; `tests/integration/inventory-summary.test.ts`.

### Independent reviews + fixes applied

- **CRITICAL (both reviews)**: `requestId` was frozen for the form's mount, so a second stock movement was silently idempotency-deduped (user saw success, stock did not move). Now rotated once per settled submission via the React-endorsed "reset state on change during render" pattern.
- **Column-level WAC leak (security review I1)**: `inventory_product_summary` exposed `weighted_average_cost` to any authenticated user via direct PostgREST query (RLS is row-level). The view now gates the column on `private.app_has_permission('inventory.view_cost')`; the dashboard value uses the new `inventory_value_for_scope` RPC so raw per-row WAC is never fetched. Both covered by new integration assertions.
- **PostgREST `.or()` injection (I2)**: the search term is now wrapped in double quotes with `"`/`\`/LIKE-wildcards escaped (`likeTerm`), so `,` `(` `)` `.` can't inject filter grammar.
- **Stock-Out client guard (I3)**: quantity is a controlled field; entering more than displayed Available shows an inline error and disables the submit button (the RPC still rechecks).
- **Tread-depth schema (I4 / code review C2)**: was integer-only while the UI uses `step="0.5"`; now `requiredNumber` accepts fractional mm.
- `searchInventory` gained a `productId` filter (detail page no longer fetches the whole catalogue); dashboard movements query error is checked and Admin-single-branch scoped; touch targets bumped to >= 44px (picker rows, reorder inputs, detail links); "All Locations" table drops the ambiguous single-branch WAC column; `set_reorder_settings` audit `entity_type` corrected to `product`.
- `tests/stock-form.test.tsx` now clicks to select a product and asserts the WAC preview appears only with `inventory.view_cost` and that a stock-out over Available disables submit; dead `next/*` mocks removed.
- `vitest.config.ts`: `fileParallelism: false` so integration files (one shared local Postgres) run serially - removes cross-file load flakes on the concurrency test.

### Accepted / deferred

- Brand/size dropdown filter controls: search covers brand/pattern/size free-text; dedicated dropdowns deferred (not a plan Step 5 requirement).
- The four stock action bodies remain near-identical (~110 lines) - a `(schema, formData, runner)` helper is a follow-up cleanup, not a correctness issue.
- `pg_trgm` GIN indexes for `ilike '%term%'` search are a production tuning item beyond Phase 1 data volumes.

### Task 7 commit

- `feat(inventory): add stock workflows search and low-stock dashboard` (commit `45a3820`).

## Task 8 - E2E security checks, CI, deployment documentation

Status: complete - implemented, all suites green, committed.

### Deliverables

- `tests/e2e/`: `fixtures.ts` (deterministic acceptance users `inventory-admin/lon/reg@test.local`, disposable-only env guard), `global.setup.ts` (provisions users + seeds two products via the Admin RPC), `helpers.ts` (login/logout, alert/status locators that skip Next's route announcer), and the four spec files: `auth.spec.ts`, `inventory-manager.spec.ts`, `inventory-admin.spec.ts`, `mobile-stock.spec.ts`.
- `playwright.config.ts`: `setup` project + `desktop` (Desktop Chrome) / `mobile` (Pixel 7) projects, `webServer` starts `npm run dev`, loads `.env.local` via `tests/load-env`.
- `.github/workflows/inventory.yml`: `static` job (npm ci -> lint -> typecheck -> test:unit -> build); opt-in `database` job that spins up an ephemeral local Supabase, applies migrations, exports the local keys, and runs `test:integration` + `test:e2e`.
- `inventory-app/README.md`, `docs/inventory-phase-1-deployment.md`.

### Verification (this run)

- Inventory app: `npm run lint`, `npm run typecheck` clean; `npm run test:unit` 63 passed; `npm run test:integration` 33 passed (after `npx supabase db reset`); `npm run build` clean (17 routes + Proxy); `npm run test:e2e` **15 passed** (11 desktop + 2 mobile + setup, plus auth redirect).
- Public root website (boundary intact): `npm run lint`, `npm run typecheck` clean; `npm test` 41 passed / 1 db test skipped; `npm run build` clean.
- Local disposable Supabase only throughout (`linked_project: null`, DB on `127.0.0.1:54332`). No remote link, no production migration, no production credentials.

### Accepted / deferred

- The E2E flow covers the Task 8 Step 2-5 acceptance items (auth + branch isolation, Quick Stock-In x2 -> on hand 20, Stock-Out block + success, adjustment with reason, used-tyre intake unit code, Admin scope + Users + reorder edit, REG Manager cost/value hidden, mobile shell + no-overflow + no QR/barcode). The negative "adjustment with no reason" assertion is covered by `stock-validation.test.ts` rather than E2E.
- `npx tsx` is used for the bootstrap script (not added as a dependency).
- Login logo emits a Next `Image` aspect-ratio console warning (cosmetic; `h-auto` is set).

### Task 8 commit

- `test(inventory): verify phase 1 security and deployment` (see git log).

## Final security hardening pass (complete)

### Implemented hardening

- Direct authenticated reads of `used_tyre_units`, `inventory_balances`, and
  `inventory_movements` are now column-limited so cost basis, unit selling
  override, WAC, inbound cost, and cost snapshots cannot be retrieved through
  PostgREST/base tables. The approved `inventory_product_summary` interface is
  a security-barrier definer view with explicit Admin/assigned-branch scope and
  per-caller `inventory.view_cost` WAC gating.
- `inventory_value_for_scope` now requires both `reports.view_inventory_value`
  and `inventory.view_cost`. All stock/count/used-unit RPC responses return
  WAC only to `inventory.view_cost` callers.
- Manager-readable audit rows are limited to metadata; unstructured `details`
  JSON is no longer granted to authenticated users, preventing current or
  future cost payloads from bypassing the cost boundary.
- Idempotency is unique per actor + location + request key, and every replay
  lookup (including the concurrent unique-violation path) is authorized and
  scoped before returning a result. A key reused for a different product/type
  in the same scope fails with `IDEMPOTENCY_KEY_REUSED`.
- Added regression coverage for direct cost reads, audit payload denial,
  summary/value gating, all mutation-RPC WAC returns, and LON/REG replay
  isolation. Also fixed blank reorder values coercing to zero, persisted the
  stock-in supplier field, and removed the orphaned duplicate used-tyre schema.
- `vitest.config.ts` now explicitly includes only unit and integration test
  files. This fixes `npm test` collecting Playwright `.spec.ts` files while
  keeping `npm run test:e2e` exclusively responsible for browser acceptance.

### Reviews and verification

- Independent security re-review: zero remaining Critical/Important findings
  by static inspection. Independent code-quality re-review: zero remaining
  Critical/Important findings.
- Passed locally: fresh `supabase db reset` applied all four Phase 1
  migrations to the unlinked `247truck-inventory` local database; inventory
  aggregate tests (99), integration tests (38), E2E (15), lint, typecheck,
  and build all passed. Root public-site tests passed (41 passed, 1 existing DB
  test skipped), as did root lint, typecheck, and build.
- No reset, remote link, remote migration, or production credential was used.

## Phase 2A Task 9 - purchasing receipt integrity and release gates

Status: implementation and local verification complete; merge-ready pending
the feature-branch CI/PR review. The local database remained unlinked and
localhost-only throughout.

### Deliverables

- Seven Phase 2A purchasing migrations: supplier permissions, purchase-order
  schema, atomic draft create/update, goods receiving, smart reordering, and
  receipt-integrity hardening.
- `20260904090000_purchase_receipt_integrity.sql` moves the generic ledger
  routine behind a private wrapper, prevents direct `purchase_receipt` ledger
  calls, and grants receipt posting only through the authorised purchase-order
  RPC.
- `tests/e2e/purchasing.spec.ts` covers Manager LON branch pinning, absence of
  approval controls, Admin approval, partial/final receipt state, WAC and stock
  updates, and reorder suggestion clearance. Its branch and receipt locators
  are scoped to the rendered PO summary and line row.
- `docs/inventory-phase-2a-deployment.md` documents local gates, server-only
  configuration, the temporary CI enforcement, and the separate normal-CI
  cleanup requirement.
