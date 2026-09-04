# Inventory Phase 3B — Quotes, Jobs and Workshop POS Implementation Plan

**Design:** `docs/superpowers/specs/2026-09-05-inventory-phase-3b-quotes-jobs-pos-design.md`
**Branch:** `feat/inventory-phase-3b-quotes-jobs-pos`
**Baseline:** `c1db816`
**Method:** TDD, additive migrations, disposable local Supabase only until production preflight

## Safety envelope

- Work only in the isolated Phase 3B worktree.
- Preserve the original dirty `C:\Users\abuba\247truck` checkout.
- Keep `main` and production untouched until the feature PR is green and merged.
- Before every reset or destructive fixture run, prove the target is localhost, `SUPABASE_TEST_ALLOW_DESTRUCTIVE=true`, and neither forbidden production ref is present.
- Never use `supabase db reset --linked`, `supabase db push` before production preflight, or direct production table mutation.
- Do not seed production customers, quotes, jobs, POS records, prices, or stock.
- Stage explicit files only and use small professional commits.

## Task 1 — Establish the clean development baseline

Files/read-only sources:

- `inventory-app/package.json`
- `inventory-app/package-lock.json`
- `inventory-app/AGENTS.md`
- `inventory-app/node_modules/next/dist/docs/**`
- `inventory-app/supabase/config.toml`
- `.github/workflows/inventory.yml`

Steps:

1. Confirm branch, HEAD, remote, and clean worktree except the two new docs.
2. Restore dependencies with `npm ci` from `inventory-app/`.
3. Read the installed Next.js 16 guides for App Router pages/layouts, Server Actions, forms, dynamic params/search params, caching/revalidation, redirects, and error/loading UI before coding.
4. Run the existing fast baseline: unit, typecheck, lint, and build.
5. Inspect `supabase status` and local temp metadata without starting or resetting production-linked state.
6. Commit the reviewed design and plan.

Expected commit: `docs(inventory): design Phase 3B quotes jobs and POS`

## Task 2 — Add failing money, validation, lifecycle, and permission unit tests

Create:

- `inventory-app/tests/unit/sales-money.test.ts`
- `inventory-app/tests/unit/sales-validation.test.ts`
- `inventory-app/tests/unit/sales-lifecycle.test.ts`
- `inventory-app/tests/unit/sales-navigation.test.tsx`

Update:

- `inventory-app/tests/unit/permissions.test.ts`
- `inventory-app/tests/unit/shell-navigation.test.tsx`

Test first:

- exact GST-inclusive extraction and cents display;
- fractional labour quantity and whole product quantity;
- line totals;
- `NULL` product price versus explicit zero;
- allowed/denied quote and job transitions;
- PO-reference and customer/vehicle validation inputs;
- all nine final permission keys;
- Admin visibility and manager-grant behavior;
- Quotes/Jobs/POS navigation placement.

Then create minimal pure modules:

- `inventory-app/lib/sales/money.ts`
- `inventory-app/lib/sales/types.ts`
- `inventory-app/lib/sales/validation.ts`
- `inventory-app/lib/sales/lifecycle.ts`
- `inventory-app/lib/sales/errors.ts`

Verification:

```powershell
npm run test:unit -- tests/unit/sales-money.test.ts tests/unit/sales-validation.test.ts tests/unit/sales-lifecycle.test.ts tests/unit/permissions.test.ts tests/unit/shell-navigation.test.tsx
npm run typecheck
```

Expected commit: `test(inventory): define Phase 3B sales contracts`

## Task 3 — Add failing quote database integration tests

Create:

- `inventory-app/tests/integration/quotes.test.ts`
- `inventory-app/tests/integration/sales-security.test.ts`

Update:

- `inventory-app/tests/integration/support/fixtures.ts`

Cover before implementation:

- permission constraint and RPC denial;
- Admin-global/manager-branch quote reads;
- atomic branch quote numbering under concurrency;
- customer and vehicle relationship validation;
- archived customer/vehicle rejection for new quotes;
- product and labour line persistence;
- exact database GST totals;
- pending price versus explicit zero;
- optimistic version conflict;
- complete quote state-transition matrix;
- PO-reference-required enforcement;
- no reservation, balance, used-unit, or movement changes for every quote action;
- accepted quote conversion creates one linked job;
- conversion retry returns the same result;
- audit attribution;
- direct table read/write denial.

Verification initially must fail for missing Phase 3B schema/RPCs.

Expected commit: `test(inventory): specify quote database workflow`

## Task 4 — Implement quote schema and secure RPCs

Create one additive imperative migration using `supabase migration new phase_3b_quotes_jobs_pos` and keep the generated timestamped filename.

Initial migration scope:

- permission constraint extension;
- document sequences;
- quotes and quote lines;
- jobs/job lines skeleton needed by conversion;
- commercial action request table;
- exact constraints, indexes, RLS, grants/revokes;
- private authorization, numbering, snapshot, line validation, and total helpers;
- quote summary/detail/search RPCs;
- create/update/transition/convert quote RPCs;
- immutable audit events and idempotency.

Rules:

- `SECURITY DEFINER` only for intentional boundary functions;
- empty `search_path` and schema-qualified references;
- revoke execute from `public`, `anon`, and inappropriate roles;
- no direct authenticated writes;
- no cost-bearing row serialization;
- deterministic locks and expected-version checks.

Verification:

```powershell
npx supabase db reset
npm run test:integration -- tests/integration/quotes.test.ts tests/integration/sales-security.test.ts
supabase db lint
```

Expected commit: `feat(inventory): add secure quote workflow`

## Task 5 — Add failing job reservation and completion integration tests

Create:

- `inventory-app/tests/integration/jobs-pos.test.ts`
- `inventory-app/tests/integration/job-concurrency.test.ts`

Cover:

- direct existing-customer job and nullable walk-in POS-origin job;
- selected vehicle ownership and archive checks;
- manager branch scope and all job/POS permissions;
- active job product reservations;
- reservation adjustment when lines change;
- cancellation release;
- concurrent reservation oversell rejection;
- grouped product and individual used-unit reservations;
- pending/inactive product rejection at transition/completion;
- labour-only jobs;
- job lifecycle matrix and version conflict;
- completion from valid states only;
- immutable `job_consumption` movements;
- balance `on_hand` and `reserved` changes;
- WAC unchanged by sale;
- cost basis snapshot from WAC/used unit;
- idempotent duplicate completion;
- request-key misuse rejection;
- concurrent completion cannot double deduct;
- audit event and actor/source links;
- unauthorized payloads omit cost/WAC fields;
- direct table mutation denial.

Expected commit: `test(inventory): specify jobs reservations and completion`

## Task 6 — Implement job reservations, completion, and POS database boundaries

Extend the Task 4 migration before it has been deployed anywhere, or add a second additive migration if Task 4 has already been shared. Do not rewrite an applied migration.

Implement:

- inventory reservations table and indexes;
- final job/job-line constraints and indexes;
- `inventory_movements.job_id` / `job_line_id` and `job_consumption` constraints;
- job summary/detail/customer/product search RPCs;
- direct/POS job creation;
- quote conversion reservations;
- active job update and transition RPCs;
- cancellation/release RPC;
- idempotent completion RPC;
- individual used-unit reserve/release/sold transitions;
- explicit cost-redacted return shapes;
- deterministic balance/unit lock order;
- audit events.

Verification:

```powershell
npx supabase db reset
npm run test:integration -- tests/integration/quotes.test.ts tests/integration/jobs-pos.test.ts tests/integration/job-concurrency.test.ts tests/integration/sales-security.test.ts
npm run test:integration -- tests/integration/inventory-concurrency.test.ts tests/integration/inventory-security-hardening.test.ts tests/integration/stock-transfers.test.ts tests/integration/purchasing-security.test.ts
supabase db lint
```

Expected commit: `feat(inventory): add job reservations and idempotent completion`

## Task 7 — Implement typed repositories and server actions with tests

Create:

- `inventory-app/lib/sales/queries.ts`
- `inventory-app/app/(protected)/quotes/actions.ts`
- `inventory-app/app/(protected)/jobs/actions.ts`
- `inventory-app/app/(protected)/pos/actions.ts`
- targeted unit tests for action payload/error/permission behavior.

Requirements:

- use server Supabase client only;
- call RPCs, never authoritative table writes;
- enforce permission and manager location before RPC calls;
- generate request UUID server-side;
- preserve request IDs across one submitted form retry where needed;
- map stable database errors to operational messages;
- revalidate only affected routes;
- return authoritative versions/totals/status.

Verification:

```powershell
npm run test:unit -- tests/unit/sales-actions.test.ts
npm run typecheck
npm run lint
```

Expected commit: `feat(inventory): add Phase 3B server boundaries`

## Task 8 — Build reusable quote/job/POS components with unit tests

Create under `inventory-app/components/sales/`:

- customer search picker;
- vehicle picker;
- product search results;
- commercial line editor;
- labour line editor;
- totals panel;
- price-pending badge/state;
- status action panel;
- responsive summary/list components.

Test:

- semantic labels and keyboard behavior;
- pending price and explicit zero rendering;
- quantity/edit/remove controls;
- permission-dependent controls;
- insufficient stock and archived/inactive states;
- mobile stacking and sticky-action class contract;
- no cost data rendered when absent.

Use existing UI primitives and design tokens. Do not add dependencies unless an inspected need cannot be met with the current stack.

Expected commit: `feat(inventory): add workshop sales components`

## Task 9 — Build quote routes and E2E workflow

Create:

- `inventory-app/app/(protected)/quotes/page.tsx`
- `inventory-app/app/(protected)/quotes/new/page.tsx`
- `inventory-app/app/(protected)/quotes/[id]/page.tsx`
- `inventory-app/app/(protected)/quotes/[id]/edit/page.tsx`
- route loading/error UI where needed;
- `inventory-app/tests/e2e/quotes.spec.ts`.

Cover Admin and branch manager create/edit/send/accept/decline/cancel/convert flows, customer/vehicle search, product/labour lines, pending price, version conflict, empty/error states, and permission denial.

Expected commit: `feat(inventory): add responsive quote workflow`

## Task 10 — Build job routes and E2E workflow

Create:

- `inventory-app/app/(protected)/jobs/page.tsx`
- `inventory-app/app/(protected)/jobs/new/page.tsx`
- `inventory-app/app/(protected)/jobs/[id]/page.tsx`
- `inventory-app/app/(protected)/jobs/[id]/edit/page.tsx`
- `inventory-app/tests/e2e/jobs.spec.ts`.

Cover existing customer/vehicle job, quote-converted job, reservation visibility, line updates, labour, branch scope, insufficient stock, cancellation release, completion, terminal lock, and duplicate completion protection.

Expected commit: `feat(inventory): add workshop job workflow`

## Task 11 — Build POS route and mobile acceptance

Create:

- `inventory-app/app/(protected)/pos/page.tsx`
- `inventory-app/tests/e2e/pos.spec.ts`
- `inventory-app/tests/e2e/mobile-sales.spec.ts`.

Update:

- shell navigation/icon definitions;
- E2E users and local-only product/stock fixtures.

Cover fast customer/walk-in selection, customer creation permission handoff, vehicle selection, product search by every required field, location availability, labour line, exact totals, save/update job, completion, pending price, insufficient stock, keyboard flow, phone/tablet layout, and no horizontal page breakage.

Expected commit: `feat(inventory): add workshop POS workflow`

## Task 12 — Full local regression gate

First prove local/disposable target safety, then run fresh and in order:

```powershell
npx supabase db reset
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
supabase db lint
```

Investigate every new failure. Do not skip, weaken, reorder away, or mask tests. Record exact test counts and tool versions.

Expected commit if fixes are needed: `fix(inventory): resolve Phase 3B regression findings`

## Task 13 — Security and concurrency self-review

Review the whole branch for:

- caller-controlled authorization/session metadata;
- missing RLS/grants/revokes/search paths;
- direct commercial-table writes;
- branch bypasses;
- invalid state jumps;
- stale update races;
- request-key collision/replay behavior;
- reservation and completion deadlocks;
- negative stock/double deduction;
- used-unit lifecycle gaps;
- pending-price coercion;
- floating-point authority;
- cost/WAC leakage in SQL, JSON, TypeScript, logs, and rendered pages;
- fake production fixtures or seed changes;
- opening-stock and existing workflow regression.

Run database advisors/lint and targeted attack/concurrency tests after remediation.

Expected commit if fixes are needed: `fix(inventory): harden Phase 3B security and concurrency`

## Task 14 — Push, PR, CI, and review

1. Confirm explicit diff/status/log and no unrelated files.
2. Push `feat/inventory-phase-3b-quotes-jobs-pos` to `origin`.
3. Prove remote SHA.
4. Open a PR against `main` with design decisions, migrations, tests, and production exclusions.
5. Wait for all CI, Vercel preview, and review checks.
6. Address every legitimate finding with focused commits and rerun affected/full gates.
7. Merge only when all required checks are green and no unresolved critical/high findings remain.
8. Record PR URL and merge SHA.

## Task 15 — Production preflight, migration, deployment, and reconciliation

Read-only preflight:

- prove Supabase project is `247truck` and record its ref without exposing credentials;
- prove Vercel project is `247truck-inventory`;
- prove deployed source is current pre-migration `main`;
- reconcile 725 REG / 0 LON opening tyres, 53 opening rows, 53 opening movements, and zero duplicate groups;
- capture customer/quote/job counts without personal data;
- confirm migration history contains only expected prior migrations.

Release:

1. Apply only committed Phase 3B migrations to the verified production project.
2. Verify schema/RPC/grant/advisor state without creating commercial records.
3. Allow production deployment from merged `main`.
4. Record deployment ID and deployed Git SHA.
5. Authenticate and perform non-mutating route/read checks for login, customers, quotes, jobs, POS, inventory, purchasing, transfers, and runtime errors.
6. Reconcile opening stock and customer/quote/job counts again; all must match preflight except legitimate user activity observed during the release window.
7. Do not create a fake production customer, quote, job, movement, or POS sale.

## Completion report

Report:

- branch and commits;
- PR URL and merge SHA;
- exact migration filenames and production migration result;
- local and CI test counts;
- security/concurrency review findings and resolutions;
- Vercel deployment ID and deployed SHA;
- production route/runtime checks;
- pre/post opening-stock reconciliation;
- pre/post non-personal customer/quote/job counts;
- any remaining unrelated findings, clearly separated from Phase 3B.
