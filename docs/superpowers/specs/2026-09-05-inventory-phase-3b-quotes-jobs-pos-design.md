# Inventory Phase 3B — Quotes, Jobs and Workshop POS Design

**Date:** 2026-09-05
**Status:** Self-reviewed implementation baseline
**Baseline:** `origin/main` at `c1db816` (Phase 3A merged)
**Application:** `inventory-app/`

## 1. Scope and decisions

Phase 3B adds an internal, branch-scoped workshop sales workflow:

`Customer → Vehicle → Quote or Job → Product/labour lines → GST-inclusive totals → Job completion`

This phase includes quotes, workshop jobs, inventory reservations, stock consumption, and a fast POS-oriented job screen. It does not issue tax invoices, record payments, process refunds, send documents, create receivables, or implement a labour catalogue. Those remain Phase 4 responsibilities.

The following decisions reconcile the approved master design with the narrower Phase 3B boundary:

- Quotes never reserve or consume stock.
- An active job reserves inventory lines. Job completion converts those reservations to immutable stock movements in one database transaction.
- POS is a fast path through the same job domain, not a public cart and not a second sales model. In Phase 3B, POS creates or updates a job and can complete it; it does not create an invoice or payment.
- A walk-in is represented by a nullable customer relationship plus a fixed historical label, `Walk-In Customer`. No fake customer master row is seeded and no parallel customer table is introduced.
- Product lines use the current global product selling price when added or refreshed while the commercial document is editable. Phase 3B does not implement discounts or price overrides.
- A product price of `NULL` remains `PRICE PENDING`. It is never coerced to zero. Draft records may retain a pending-priced line, but they cannot be sent, accepted, converted, or completed until every line has an authoritative price.
- An explicit product or labour price of `0.00` is valid and distinct from `NULL`.
- Quote and job totals are database-authoritative exact decimals. Browser calculations are previews only.

## 2. Existing architecture reused

Phase 3B extends, rather than bypasses, the existing architecture:

- Supabase Auth identity from `auth.users` and `public.user_profiles`.
- Admin-global and manager-single-branch access from `private.app_is_admin()`, `private.app_user_location_id()`, and `private.app_has_permission()`.
- Global Phase 3A customer, contact, and vehicle identities.
- Location-specific `inventory_balances` with `on_hand`, `reserved`, and `available = on_hand - reserved`.
- Append-only `inventory_movements`; application code never writes balances directly.
- Existing product selling price and individual used-tyre model.
- `audit_events` for immutable business audit history.
- RPC-only authoritative mutations with explicit grants and direct-table denial.
- Transaction advisory locks, deterministic row-lock ordering, request idempotency, and optimistic versions.
- Existing protected Next.js shell, `PageHeader`, navigation permission filtering, server actions, responsive desktop tables/mobile cards, and live-region form feedback.

## 3. Permissions

The final Phase 3B permission keys are:

- `quotes.view`
- `quotes.create`
- `quotes.edit`
- `quotes.accept`
- `jobs.view`
- `jobs.create`
- `jobs.edit`
- `jobs.complete`
- `pos.use`

These keys must be added identically to:

- the `manager_permissions_permission_key_check` constraint;
- the TypeScript `PermissionKey` union;
- `MANAGER_GRANTABLE_PERMISSIONS` and `PERMISSION_LABELS`;
- protected navigation and route guards;
- server actions;
- database RPC authorization;
- integration, unit, and E2E fixtures/tests.

Admin receives all permissions through the existing role override. Managers receive only explicitly enabled keys and remain restricted to their assigned location.

Permission semantics:

- `quotes.view`: list and read quotes in the permitted branch.
- `quotes.create`: create branch quotes and add their initial lines.
- `quotes.edit`: update editable quote fields/lines and perform non-acceptance transitions such as send, decline, expire, or cancel where valid.
- `quotes.accept`: record customer acceptance. It does not reserve or consume stock.
- `jobs.view`: list and read jobs in the permitted branch.
- `jobs.create`: create direct jobs or convert an accepted quote into a job.
- `jobs.edit`: update editable jobs, lines, scheduling/state, and cancel jobs with reservation release.
- `jobs.complete`: complete jobs and consume stock.
- `pos.use`: access the POS screen and create/update a POS-origin job; completion additionally requires `jobs.complete`.

Customer creation from POS continues to require `customers.create`; vehicle creation continues to require `customers.manage_vehicles`. React visibility is not an authorization boundary.

## 4. Numbering

Extend the existing location-aware document-number convention with one locked sequence per location and document type:

- `LON-QUO-000001`, `REG-QUO-000001`
- `LON-JOB-000001`, `REG-JOB-000001`

Use a `document_sequences` table keyed by `(location_id, document_type)` or an equivalent private helper if a compatible sequence table already exists when implementation begins. Allocation occurs inside the create transaction and numbers are never reused.

## 5. Quote data model

### 5.1 `quotes`

- `id uuid primary key`
- `quote_number text unique not null`
- `location_id uuid not null references locations(id)`
- `customer_id uuid not null references customers(id)`
- `customer_vehicle_id uuid null references customer_vehicles(id)`
- `status text not null`
- `customer_reference text null`
- `internal_notes text null`
- `customer_notes text null`
- `expiry_date date null`
- customer and vehicle snapshot fields required for historical display
- `subtotal_ex_gst numeric(14,2) not null`
- `gst_amount numeric(14,2) not null`
- `total_incl_gst numeric(14,2) not null`
- `pricing_complete boolean not null`
- `version integer not null default 1`
- `created_by uuid not null`
- `created_at`, `updated_at timestamptz not null`
- transition actor/timestamp fields where useful (`sent_at`, `accepted_at`, `converted_at`)

The customer must be active when a quote is created. Historical quote reads use snapshots so later customer edits do not rewrite the commercial record. The foreign key remains for traceability.

### 5.2 `quote_lines`

- `id uuid primary key`
- `quote_id uuid not null references quotes(id)`
- `line_position integer not null`
- `line_type text check in ('product','labour')`
- `product_id uuid null references products(id)`
- `description text not null`
- `quantity numeric(12,3) not null check quantity > 0`
- `unit_price_incl_gst numeric(14,2) null check >= 0`
- `line_total_incl_gst numeric(14,2) null check >= 0`
- `created_at timestamptz not null`

Product lines require a product and whole-number quantity. Labour lines have no product, use free-text description, and may use fractional quantity/hours. A `NULL` price produces a `NULL` line total and sets the quote header `pricing_complete = false`.

Product descriptions and prices are snapshots. Later product edits do not change an accepted, declined, cancelled, expired, or converted quote.

## 6. Quote lifecycle

Statuses:

- `draft`
- `sent`
- `accepted`
- `declined`
- `expired`
- `cancelled`
- `converted_to_job`

Allowed transitions:

- `draft → sent`
- `draft → cancelled`
- `sent → accepted`
- `sent → declined`
- `sent → expired`
- `sent → cancelled`
- `accepted → converted_to_job`
- `accepted → cancelled` only before conversion

No other jump is valid. Status is changed only by dedicated database RPCs. The RPC locks the quote, verifies expected version, permissions, branch, current state, required customer PO/reference, price completeness, and line presence, then writes audit history.

Draft quote fields and lines are editable. A sent quote is commercially frozen except for an explicit transition. Terminal statuses are read-only. Acceptance does not create a reservation or movement. Conversion is idempotent and creates exactly one linked job.

Expiry is stored only when supplied; Phase 3B does not add automatic expiry scheduling. A user with `quotes.edit` records the `expired` transition explicitly after validating the date.

## 7. Job data model

### 7.1 `jobs`

- `id uuid primary key`
- `job_number text unique not null`
- `location_id uuid not null references locations(id)`
- `source_quote_id uuid null unique references quotes(id)`
- `source_type text check in ('direct','quote','pos')`
- `customer_id uuid null references customers(id)`
- `customer_vehicle_id uuid null references customer_vehicles(id)`
- fixed walk-in/customer/vehicle historical snapshot fields
- `status text not null`
- `vehicle_registration text null`
- `odometer integer null check >= 0`
- `customer_reference text null`
- `technician_notes text null`
- `customer_notes text null`
- `scheduled_at timestamptz null`
- `opened_at timestamptz not null`
- `completed_at timestamptz null`
- `assigned_user_id uuid null references auth.users(id)`
- `created_by uuid not null references auth.users(id)`
- exact total and pricing-complete columns matching quotes
- `version integer not null default 1`
- `created_at`, `updated_at timestamptz not null`

A non-walk-in customer must exist and be active when a direct job is created. A selected vehicle must belong to that customer. Archived customer/vehicle snapshots remain readable on existing jobs, but cannot be newly selected.

For business customers with `po_reference_required = true`, a nonblank customer reference is required before quote send/accept/conversion and before job completion. Draft creation remains possible so workshop staff can begin work while obtaining the reference.

### 7.2 `job_lines`

- quote-compatible commercial snapshot fields
- `used_tyre_unit_id uuid null references used_tyre_units(id)`
- `reserved_quantity integer not null default 0`
- `cost_basis numeric(14,4) null`
- `inventory_movement_id uuid null references inventory_movements(id)`

Inventory lines require whole-number quantity. An individually tracked used tyre must identify one active unit, has quantity exactly one, uses its unit price override when present otherwise the product selling price, and follows that unit's location/status lifecycle. Grouped used stock remains quantity-based.

`cost_basis` is populated only at completion from the branch WAC or individual used-unit cost. It is never accepted from the browser. Cost is omitted from all normal job/POS payloads unless the caller also has `inventory.view_cost`.

## 8. Job lifecycle

Statuses:

- `new`
- `scheduled`
- `in_progress`
- `waiting`
- `completed`
- `cancelled`

Allowed transitions:

- `new → scheduled | in_progress | waiting | cancelled`
- `scheduled → in_progress | waiting | cancelled`
- `in_progress → waiting | completed | cancelled`
- `waiting → scheduled | in_progress | completed | cancelled`

`completed` and `cancelled` are terminal. Completion uses its own `jobs.complete` RPC and cannot be performed through a generic status setter.

Editable active-job updates use `p_expected_version`. The transaction locks the job and all affected balances/used units in deterministic order, validates current reservations, replaces or adjusts lines, and updates reservations atomically. Stale updates fail with `JOB_VERSION_CONFLICT` and do not partially alter lines or stock.

Cancellation releases all active reservations, sets individual used units back to `available`, increments the version, and audits the transition. It does not create a physical stock movement because on-hand stock did not change.

## 9. Inventory reservations

Add `inventory_reservations` as an authoritative reservation ledger:

- `id uuid primary key`
- `job_id uuid not null references jobs(id)`
- `job_line_id uuid not null unique references job_lines(id)`
- `product_id uuid not null references products(id)`
- `used_tyre_unit_id uuid null references used_tyre_units(id)`
- `location_id uuid not null references locations(id)`
- `quantity integer not null check > 0`
- `status text check in ('active','consumed','released')`
- `created_by`, `created_at`, `updated_at`

Reservation mutation is private to job RPCs. Authenticated users receive no direct table writes.

When an active job is created or its product lines change:

1. Lock the job when applicable.
2. Acquire one job/request advisory transaction lock.
3. Lock affected `inventory_balances` in `(location_id, product_id)` order.
4. Lock selected used units in UUID order.
5. Calculate the net reservation delta per product.
6. Require `on_hand - reserved >= positive_delta`.
7. Apply `inventory_balances.reserved += delta`.
8. Insert/update/release reservation rows.
9. Set selected used units to `reserved` or back to `available` as needed.
10. Persist job lines/header totals and audit once.

The database check `0 <= reserved <= on_hand` remains intact. Reservation changes never alter `on_hand` and never create inventory movements.

## 10. Job completion and stock consumption

`complete_job(p_job_id, p_expected_version, p_request_id)` is the only Phase 3B stock-consumption boundary.

The function is `SECURITY DEFINER`, has `search_path = ''`, is executable only by `authenticated`, and explicitly verifies:

- authenticated active user;
- `jobs.complete`;
- manager branch equals job branch;
- active, nonterminal job state and expected version;
- at least one line;
- all prices complete;
- required PO/reference present;
- every product and used unit remains valid at the job location;
- active reservations exactly match product job lines;
- sufficient on-hand/reserved quantities.

The transaction then:

1. Acquires advisory locks for request and job.
2. Returns the stored result for an identical completed request.
3. Rejects reuse of the request UUID for another payload/action.
4. Locks job, reservation, used-unit, and balance rows in deterministic order.
5. Captures location WAC or individual used-unit cost into each product job line.
6. Inserts one immutable `inventory_movements` row per product line with movement type `job_consumption`, negative quantity, `source_type = 'job'`, `source_id = job_id`, and explicit `job_id`/`job_line_id` links.
7. Decrements `inventory_balances.on_hand` and `reserved` by the consumed quantity without changing WAC.
8. Marks individual used units `sold`.
9. Marks reservations `consumed`.
10. Sets the job `completed`, timestamps it, increments version, and writes audit events.
11. Stores the idempotent result.

Any error rolls back every step. A retry cannot create duplicate movements or deduct stock twice. Completion never calls the generic caller-controlled stock RPC.

Extend `inventory_movements` additively with `job_id` and `job_line_id`, indexed foreign keys, and `job_consumption` in the movement/direction constraints. Preserve all existing opening-stock, purchasing, transfer, adjustment, and used-unit semantics.

## 11. Idempotency and concurrency

Create a commercial action request table, or equivalently scoped quote/job action tables, containing:

- request UUID primary key;
- action;
- actor;
- entity;
- canonical payload hash;
- stored result;
- timestamp.

Create, quote conversion, and job completion require request UUIDs. Replaying the same actor/action/payload returns the stored result. Reusing a UUID with a different actor/action/payload fails with `IDEMPOTENCY_KEY_REUSED`.

Quote/job updates and transitions require expected versions. Database row locks serialize competing writes; version checks reject stale saves instead of silently overwriting them.

## 12. Totals and GST

All authoritative money columns use `numeric`; no floating point is used in PostgreSQL.

For each priced line:

- `line_total_incl_gst = round(quantity * unit_price_incl_gst, 2)`

For each document:

- `total_incl_gst = sum(line_total_incl_gst)`
- `gst_amount = round(total_incl_gst / 11, 2)`
- `subtotal_ex_gst = total_incl_gst - gst_amount`

This implements standard 10% GST extraction from GST-inclusive prices and guarantees `subtotal_ex_gst + gst_amount = total_incl_gst` at cents precision.

Totals are recalculated inside every line mutation RPC. Client-side previews use integer cents or a decimal-safe string strategy and are replaced by returned database totals after save.

## 13. Database security and API surface

Tables:

- `document_sequences`
- `quotes`
- `quote_lines`
- `jobs`
- `job_lines`
- `inventory_reservations`
- `commercial_action_requests`

All tables enable RLS. Revoke all table privileges from `public`, `anon`, and `authenticated`. Grant only required service-role maintenance access. Authenticated access occurs through explicitly granted RPCs.

Public RPC groups:

- search/list/detail: `quote_summary`, `quote_detail`, `job_summary`, `job_detail`, `sales_customer_search`, `sales_product_search`;
- quote mutations: create, update draft, transition, convert;
- job mutations: create, update, transition/cancel, complete;
- POS: create/update through job RPCs, not separate authoritative tables.

Private helpers own validation, authorization, numbering, totals, snapshots, reservations, stock consumption, and audit insertion. Every `SECURITY DEFINER` function uses an empty search path and schema-qualified objects/functions. Execute is revoked from unintended roles.

Search/detail RPCs return an explicit JSON/table shape. They never use `to_jsonb(row)` for job lines containing cost fields. `cost_basis`, WAC, inbound costs, and valuation data are included only when `private.app_has_permission('inventory.view_cost')` is true; otherwise those keys are absent or null at the database boundary.

## 14. Search and indexes

No page loads the full customer, product, quote, or job catalogue.

Customer search reuses `search_customers` with a small server limit and then loads active vehicles for the selected customer. It searches customer number/name/company, phone, email, ABN, vehicle registration, and fleet number.

Product search is a new branch-scoped RPC with a bounded limit and minimum practical query length. It searches normalized product name/reference, brand, pattern, and size and returns:

- product identity and display fields;
- active state;
- location on-hand/reserved/available;
- global selling price or `NULL`;
- eligible individual used-unit summaries where relevant;
- no WAC/cost unless separately authorized and specifically needed.

Add indexes matching demonstrated access paths:

- quote/job `(location_id, status, created_at desc, id desc)`;
- quote/job number unique indexes;
- quote/job customer and vehicle foreign-key indexes;
- line parent and product foreign-key indexes;
- active reservation `(location_id, product_id)` partial index;
- action entity/request indexes;
- product normalized search support only after validating the actual query plan. Prefer existing normalized lookup indexes and bounded searches; add `pg_trgm` indexes only if local `EXPLAIN` evidence warrants them.

List pages use bounded keyset pagination by `(created_at, id)` rather than unbounded lists or deep `OFFSET` scans.

## 15. Server and UI architecture

New modules:

- `lib/sales/money.ts`
- `lib/sales/types.ts`
- `lib/sales/validation.ts`
- `lib/sales/errors.ts`
- `lib/sales/queries.ts`
- quote/job/POS server actions under protected routes;
- reusable customer picker, vehicle picker, product search, line editor, totals panel, status actions, and responsive summary components.

Routes:

- `/quotes`
- `/quotes/new`
- `/quotes/[id]`
- `/quotes/[id]/edit`
- `/jobs`
- `/jobs/new`
- `/jobs/[id]`
- `/jobs/[id]/edit`
- `/pos`

Desktop uses compact tables, keyboard-focusable search, dense line editing, and a persistent totals panel. Mobile uses cards, stacked line editors, large controls, and a sticky primary save/complete action without horizontal page overflow.

Required states are explicit: loading, empty, query/load error, permission denied redirect, price pending, insufficient stock, archived customer, inactive product, version conflict, terminal/completed state, and duplicate-submit pending state.

Keyboard behavior:

- search fields receive predictable focus;
- Enter selects the highlighted exact result only when unambiguous;
- Escape closes search results;
- line controls have stable accessible names;
- no workflow depends on hover, pointer precision, or hidden gestures.

Navigation adds Quotes, Jobs, and POS using the exact permissions above. Jobs occupies a high-frequency mobile bar slot consistent with the master design; Quotes and POS remain in More unless final layout testing shows a safe four-slot arrangement.

## 16. Validation and operational errors

Validation is duplicated intentionally at three boundaries:

- TypeScript/Zod for immediate form feedback;
- server actions for authorization, branch scope, and safe payload construction;
- PostgreSQL constraints/RPC checks as authority.

Stable database error codes map to operational messages, including:

- `QUOTE_VERSION_CONFLICT`
- `JOB_VERSION_CONFLICT`
- `INVALID_QUOTE_TRANSITION`
- `INVALID_JOB_TRANSITION`
- `PRICE_PENDING`
- `CUSTOMER_ARCHIVED`
- `VEHICLE_ARCHIVED`
- `VEHICLE_CUSTOMER_MISMATCH`
- `PRODUCT_INACTIVE`
- `PO_REFERENCE_REQUIRED`
- `INSUFFICIENT_STOCK`
- `USED_TYRE_NOT_AVAILABLE`
- `IDEMPOTENCY_KEY_REUSED`
- `ACCESS_DENIED`

Raw database messages are not shown directly.

## 17. Audit model

Audit at minimum:

- `QUOTE_CREATED`
- `QUOTE_UPDATED`
- `QUOTE_STATUS_CHANGED`
- `QUOTE_CONVERTED_TO_JOB`
- `JOB_CREATED`
- `JOB_UPDATED`
- `JOB_STATUS_CHANGED`
- `JOB_RESERVATIONS_CHANGED`
- `JOB_COMPLETED`
- `JOB_CANCELLED`
- `JOB_STOCK_CONSUMED`

Details contain identifiers, number, branch, versions, before/after status, line counts, total changes, request ID, and movement IDs where useful. They do not duplicate full customer contact details, notes, or other unnecessary personal data. Price override audit is omitted because Phase 3B does not support overrides.

## 18. Testing strategy

### Unit

- quote/job Zod validation;
- exact cents/GST display helpers;
- line totals and decimal quantities;
- `NULL` pending price versus explicit zero;
- allowed status transitions;
- permission-driven navigation/actions;
- error mapping and archived/inactive states;
- responsive line editor behavior.

### Integration against disposable local Supabase

- quote creation, snapshots, numbering, totals, and direct table denial;
- optimistic quote update conflict;
- every allowed and denied quote transition;
- quote acceptance creates no reservation or movement;
- one-time accepted quote conversion;
- direct customer job and walk-in POS job creation;
- customer/vehicle ownership and archive checks;
- PO-reference enforcement;
- branch-scoped reads and mutations;
- manager permission matrix and Admin global access;
- product/labour line persistence and price snapshots;
- pending-price blocking and explicit-zero acceptance;
- reservation create/change/release;
- no-negative-stock under concurrent jobs;
- idempotent completion and duplicate request retry;
- immutable job-consumption movements and actor/source linkage;
- individual used-tyre reserve/sell behavior;
- cost snapshot correctness and unauthorized cost-field absence;
- immutable audit events;
- authenticated direct INSERT/UPDATE/DELETE denial.

### Playwright

- Admin quote create → send → accept → convert → complete job;
- manager branch quote/job workflow;
- existing customer → vehicle → job;
- server-backed product search by brand/pattern/size/reference;
- free-text labour line;
- POS customer/product/job workflow;
- mobile quote/job/POS layout and sticky action;
- price-pending state;
- insufficient stock;
- completed job retry does not deduct twice;
- permission-denied navigation/direct route behavior.

E2E fixture data remains local/disposable only. Tests use semantic unique locators and never hide ambiguity with `.first()` or `.nth()`.

## 19. Regression and release safety

The required local gate order is:

1. Confirm `supabase status` uses localhost and `supabase/.temp/project-ref` is absent or local-only.
2. `npx supabase db reset`
3. `npm run test:unit`
4. `npm run test:integration`
5. `npm run typecheck`
6. `npm run lint`
7. `npm run build`
8. `npm run test:e2e`
9. `supabase db lint`

Existing auth, dashboard, inventory, opening stock, pending financials, stock operations, used tyres, suppliers, purchasing/receiving/reorder, transfers, customers, contacts, and vehicles remain in the full regression suite.

Before production migration, use read-only checks to verify the exact Supabase/Vercel targets and reconcile:

- Regency Park opening stock: 725 tyres;
- Lonsdale opening stock: 0 tyres;
- 53 opening-stock rows;
- 53 opening-stock movements;
- no duplicate opening-stock groups;
- no unexpected customer/job mutations.

Only committed Phase 3B migrations may be applied. No fake production customer, quote, job, or POS record is created for verification. Post-deploy checks use authenticated reads and existing real records without mutating production stock or commercial data.

## 20. Explicit exclusions

- tax invoices and invoice numbering;
- payments, Stripe, EFTPOS reconciliation, cash handling, refunds;
- receivables, reminders, debtor management, credit limits;
- email/PDF delivery;
- discounts and price overrides;
- labour catalogue, labour cost, payroll, technician wages;
- profitability/reporting beyond secure cost snapshots needed for Phase 4;
- accounting/BAS integration;
- multi-currency;
- roadside membership entitlements;
- public ecommerce/cart behavior.

## 21. Design self-review

The design was checked against the approved master specification and the merged Phase 1–3A implementation.

- Quote and job statuses match the master design; invalid transitions remain database-rejected.
- Quote creation, editing, sending, and acceptance never reserve or consume stock.
- Job reservations use the existing `reserved` balance invariant; physical consumption remains append-only and completion-only.
- Quote/job data references the global Phase 3A customer master while branch-scoping the operational document.
- Product prices remain global, GST-inclusive, snapshot-based, and pending-aware.
- Manager access remains permission-gated and branch-scoped; Admin remains global.
- Cost snapshots are captured for future reporting but withheld at the database response boundary without `inventory.view_cost`.
- POS reuses jobs and does not pull Phase 4 invoices/payments into Phase 3B.
- No migration seed or E2E path creates fake production customers, quotes, jobs, or stock.
- Existing opening-stock, purchasing, transfer, used-unit, WAC, audit, and direct-table-denial invariants are preserved.

No conflict with the master design was found after applying the explicit Phase 3B scope decisions in section 1.

## 22. Acceptance criteria

Phase 3B is acceptable when:

1. Authorized staff can create and manage branch quotes using Phase 3A customers/vehicles.
2. Quote state transitions are database-controlled, audited, version-safe, and never alter inventory.
3. An accepted quote converts once into a branch job without re-entry.
4. Direct and POS-origin jobs share one authoritative job model.
5. Active job product lines reserve stock without changing on-hand.
6. Cancellation releases reservations; completion atomically consumes stock.
7. Completion is idempotent and concurrent jobs cannot oversell.
8. Individual used tyres retain unit-level reservation and sold state.
9. All displayed/stored prices are GST-inclusive; totals are exact and historically stable.
10. `NULL` prices display `PRICE PENDING` and are never treated as zero.
11. Unauthorized managers cannot access another branch or receive cost fields.
12. Authoritative tables reject direct authenticated writes.
13. Desktop, tablet, and phone workflows pass accessibility-oriented E2E coverage.
14. Every required fresh local gate passes without new skips.
15. Production opening-stock evidence remains exactly reconciled and no fake production commercial data is inserted.
