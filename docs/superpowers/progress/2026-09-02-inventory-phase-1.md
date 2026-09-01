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

- `feat(inventory): add roles locations permissions and audit` (see git log).
