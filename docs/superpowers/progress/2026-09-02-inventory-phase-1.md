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

- `feat(inventory): add login access context and manager invitations` (see git log).
