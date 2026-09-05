# Inventory Phase 4 — Invoicing, Payments and Receivables Detailed Design

**Date:** 2026-09-06

**Status:** Final technical planning baseline; implementation not started. Business configuration/activation decisions are listed in section 25.

**Application:** `inventory-app/` — separate Next.js inventory deployment.

**Released source baseline:** `2cb8a366ae76b47160044a9972bb78822e3ce21c`.

**Production identity supplied by owner:** `https://247trucktyreservices.store`, deployment `dpl_9kSvetADWgdmXGuC1LmznaZ8TGUb`, Supabase `247truck` / `afefdlvepdbtaxoscwew`. These identities were not revalidated against production services during planning.

## 1. Authority, baseline and safety boundary

Read together with:

- [Master design](2026-09-02-inventory-software-design.md), particularly sections 21–29, financial integrity, atomic transactions and Phase 4/5 boundaries.
- [Released Phase 3B design](2026-09-05-inventory-phase-3b-quotes-jobs-pos-design.md).
- [Phase 3B plan](../plans/2026-09-05-inventory-phase-3b-quotes-jobs-pos.md).
- [Phase 4 implementation plan](../plans/2026-09-06-inventory-phase-4-invoicing-payments-receivables.md).

Actual released SQL/code wins over conceptual names. This document explicitly resolves master-spec ambiguities; it does not replace or edit Phase 3B documentation.

On 2026-09-06, `git fetch origin` succeeded and `git rev-parse origin/main` returned the exact required SHA. The original checkout `C:/Users/abuba/247truck` was on local `main` at `b437ddd`, with unrelated untracked `.agents/`, `AGENTS.md`, `CLAUDE.md`, `inventory-app/x`, and `skills-lock.json`. A new documentation branch/worktree was created from verified `origin/main`: `docs/inventory-phase-4-plan`, `C:/Users/abuba/.worktrees/247truck-phase-4-plan`. The detached Phase 3B release worktree contains an existing modification to its Phase 3B plan; it is preserved. No clean/reset/stash/prune was used.

Planning changes are exclusively these two new Markdown files. No production connection, database mutation, migration file, application change, provider setup, webhook registration, scheduler, financial record, commit, push or deployment is part of this session.

The owner-supplied release closure evidence is immutable: opening imports 53; opening movements 53; Regency Park opening/on-hand 725/725 and reserved 0; Lonsdale 0/0/0; duplicate source/request/import groups 0; negative balances 0; reserved greater than on-hand 0; customers/contacts/vehicles/quotes/jobs/reservations 0 at closure. These are historical observations, not a command to reset later legitimate business activity to zero. Future preflight must distinguish immutable opening evidence from live balances changed by authorised post-release operations.

## 2. Released architecture inventory

All paths below are relative to the repository root. SQL descriptions include later migration overlays, not just initial CREATE TABLE definitions.

| Domain | Exact released objects and reusable contract |
|---|---|
| Identity | `auth.users`; `public.user_profiles(user_id,display_name,role,location_id,active)`; role `admin` or `manager`; manager has exactly one location, Admin has no assigned location. No new user/location assignment table. |
| Permissions | `public.manager_permissions(user_id,permission_key,enabled)`; `private.app_is_admin()`, `private.app_user_location_id()`, `private.app_has_permission(text)`; active Admin override, explicit active-manager grant, fixed active branch. |
| Locations | `public.locations(id,code,name,active)`; `LON`, `REG` only. |
| Customers | `public.customers`: `customer_number`, `customer_type` (`individual`,`business`), `display_name`, company/legal names/ABN, normalized search fields, `email`, `billing_email`, `accounts_email`, address parts, `payment_terms` (`due_on_receipt`,`7_days`,`14_days`,`30_days`), `po_reference_required`, `active`, `version`. Global identity; financial history remains branch scoped. |
| Contacts/vehicles | `public.customer_contacts`: `primary_contact`, `billing_contact`, `active`, email, customer FK, version; one active primary enforced, multiple billing contacts possible. `public.customer_vehicles`: customer FK, registration/normalized registration, fleet number, make/model/year/body description, vehicle type, active, version. |
| Customer requests | `public.customer_rpc_requests(request_id,action,actor_user_id,payload_hash,entity_id,result,created_at)`; `public.customer_number_sequence(singleton,last_number)`. |
| Quotes | `public.quotes`, `public.quote_lines`; quote states `draft,sent,accepted,declined,expired,cancelled,converted_to_job`; customer/vehicle JSON snapshots, nullable total when price pending, integer version. Line types `product,labour`; quantity `numeric(12,3)`, price/total `numeric(14,2)`. |
| Jobs | `public.jobs`: `source_quote_id` unique nullable, `source_type` (`direct,quote,pos`), customer/vehicle nullable, JSON snapshots, `completed_at`, version, totals/pricing_complete; `public.job_lines`: `is_active`, `cost_basis numeric(14,4)` nullable, `inventory_movement_id uuid`, optional `used_tyre_unit_id`. |
| Sales requests | `public.commercial_action_requests(request_id,action,actor_user_id,entity_id,payload_hash,result,created_at)`; advisory request locks, optimistic versions. New finance requests use their own stricter envelope, preserving the old contract. |
| Reservations | `public.inventory_reservations(job_id,job_line_id,product_id,used_tyre_unit_id,location_id,quantity,status)`; status `active,consumed,released`; one active reservation per line. |
| Inventory | `public.inventory_balances(product_id,location_id,on_hand,reserved,weighted_average_cost)`; integer quantities, available derived. `public.inventory_movements` append-only, source/type/actor/request keys, `cost_snapshot numeric(14,4)` nullable after pending-financial overlay. `public.post_inventory_movement` owns balance/ledger writes. |
| Used units | `public.used_tyre_units`: `internal_unit_code`, product/location, tread/condition, `cost_basis numeric(14,4)` currently required, `selling_price_override` nullable, `status` (`available,reserved,sold,scrap`). |
| Cost overlay | `20260904150000_pending_financials.sql` allows NULL product price, WAC and movement cost. `20260904153000_pending_valuation.sql` handles pending valuation. Unknown cost is not zero. |
| Audit | `public.audit_events(id,actor_user_id,actor_role,location_id,event_type,entity_type,entity_id,details,created_at)`; entity ID is text, actor may be NULL. `private.sales_audit(...)` supplies staff audit semantics. Detail JSON is not generally exposed by table select. |
| Numbering | `public.document_sequences(location_id,document_type,last_number)`. General `private.next_location_document_number(uuid,text,text)` serves purchase order/PO, goods receipt/GRN, stock transfer/TRF. Separate `private.next_sales_number(uuid,text)` only accepts quote/job. Reuse the general helper for invoice/INV, receipt/RCT, credit note/CRN; do not widen the sales helper unnecessarily. |

Principal SQL evidence: `inventory-app/supabase/migrations/20260902090000_identity_access.sql`, `20260902091000_product_catalog.sql`, `20260902092000_inventory_ledger.sql`, `20260903091000_purchase_orders.sql`, the pending-financial migrations, `20260905100000_stock_transfers.sql`, `20260905110000_customers_fleets_vehicles.sql`, and `20260905120000_phase_3b_quotes_jobs_pos.sql`.

`public.complete_job(uuid,integer,uuid)` in the final Phase 3B migration is the canonical stock-consuming transaction. It checks `jobs.complete`, locks the request/job/reservations, posts deterministic job-source movements, snapshots cost, marks exact used units sold and reservations consumed, then completes the job and records request/audit evidence. Phase 4 must call it inside a database wrapper, never copy its stock loop into finance code. `job_lines.inventory_movement_id` currently lacks a declared FK; finance must validate that relationship rather than assuming a FK proves it.

Application evidence:

- `inventory-app/package.json`: Node 22.x, Next 16.3.3, React 19.2.6, TypeScript 5.9.3, Supabase JS 2.112.4/SSR 0.12.5, Zod 4.5.4. This is Next.js, despite generic workspace framework metadata.
- `app/(protected)/layout.tsx` calls `getCurrentAccess()` and `getCurrentLocationScope()`, then renders `AppShell`.
- `lib/auth/{types,permission-keys,permissions,access,access-context}.ts` implement permission types, grants, labels, active access and Admin override.
- `components/shell/nav.ts` owns desktop/mobile/More navigation and permission filtering.
- `app/(protected)/jobs/actions.ts`: `createJobAction`, `updateJobAction`, `transitionJobAction`, `cancelJobAction`, `completeJobAction`; quote actions use corresponding snake-case RPCs. Version is bound from fetched data. Known errors are mapped to safe messages; unknown errors are generic.
- `lib/action-result.ts` provides `ActionResult<T>` and `actionError`; finance standardises this existing discriminated result pattern and adds `lib/finance/errors.ts`, without unrelated sales error refactoring.
- `components/sales/sale-draft-form.tsx` and `lib/sales/{queries,lifecycle,money}.ts` supply forms/query/lifecycle/money patterns; `/api/sales/customers`, `/vehicles`, `/products`, `/used-units` use permission-checked server search. Preserve debounce, cancellation and stale-response protection.
- `/pos` currently creates POS-origin jobs using the shared form; no payment or invoice is present.
- `.github/workflows/inventory.yml` has static and disposable local Supabase integration/E2E jobs; `tests/integration/jobs.test.ts`, `jobs-pos.test.ts`, `job-concurrency.test.ts`, `sales-security.test.ts` are primary regression anchors.

Provider inventory: no Stripe SDK, Stripe route, Resend integration, or cron exists in `inventory-app`. The root public website has Resend SDK usage in `app/api/enquiries/route.ts` and REST helpers in `app/lib/{booking-email,membership-email,membership-activation-email}.ts`. Reuse the server-only integration approach, not marketing sender credentials, routes, templates or deployment assumptions. No provider secret values were read. No tracked Vercel cron configuration was found.

## 3. Final scope and explicit exclusions

Include invoices/drafts/revisions, job and POS invoicing, manual service invoices, exact GST, line discounts, due dates, invoice-specific manual and Stripe payments, reversals, invoice-scoped credit/refund documents, operational receivables/reconciliation, immutable PDFs, Resend invoice/receipt/payment-link/credit/refund delivery, retry evidence and four-stage reminders. Integrate jobs/POS/customer detail and existing permission administration.

Exclude Phase 5 sales/profit/valuation dashboards and broad exports, BAS/accounting-system replacement, payroll, currency other than AUD, customer credit limits, transferable customer credits/unallocated deposits, multi-invoice allocation, fixed labour catalogue, public ecommerce, memberships, new branches, native/offline transactions, stock-return implementation, purchasing/transfer redesign and opening-stock changes. Quotes, PO and transfer PDFs/emails are explicitly deferred from this Phase 4 release even though the master includes them in the eventual document suite. Their existing workflows remain available.

## 4. Resolved financial and workflow decisions

### 4.1 Invoice timing and source ownership

| Entry path | Canonical behaviour |
|---|---|
| Completed Phase 3B job | Explicit `create_invoice_from_job` produces one draft invoice and line snapshots. Does not call completion or inventory RPCs. No automatic historical backfill. |
| Job completion, Create invoice selected | `complete_job_and_create_invoice` calls released `complete_job` and creates the draft invoice in the same DB transaction. Issue is a separate explicit action unless POS finalisation. |
| Complete without invoice | Existing completion remains valid; show Completed — Not invoiced with permitted Create invoice action. |
| POS manual tender | One `finalise_pos_sale` transaction creates/updates the POS job, completes it, creates and issues invoice, and posts manual tender rows. Failure rolls back every DB effect. |
| POS on account | Same transaction without tender, only for a business customer, with `pos.use`, relevant jobs permissions and `invoices.issue`. Customer terms determine due date. No new credit-limit system. |
| POS online card | Complete/issue atomically, then initiate Stripe outside DB transaction. Show Awaiting online payment; physical handover confirmation waits for verified success. External settlement cannot be atomic with stock. |
| Individual/walk-in POS | Manual flow requires full settlement, including split tenders; online flow explicitly displays payment pending. No on-account override for managers/Admin. Job invoicing outside POS can remain due on receipt. Zero-total sales need no payment. |
| Manual invoice | Free-text labour/service/other-charge descriptions using `labour` type only; no product or used-unit IDs. Selling stock uses the shared job/POS path. Manual finance cannot bypass consumption. |
| Quote flow | Accepted quote → existing conversion → job completion → invoice. No direct quote-to-invoice stock path. |

One `invoices.job_id` per job, even when cancelled. Source job/quote, customer and branch links never change after invoice creation. Cancellation of a stock invoice is a financial action, not permission to sell those units again. Do not create a second invoice for that job; use immutable unpaid revisions before cancellation or a separately authorised manual service document only for genuinely separate charges. A mistaken terminal cancellation requires an incident-reviewed forward correction, not an ordinary duplicate job invoice.

Completed-job proof: job is completed with `completed_at`; each active product line has a referenced outbound movement matching job source ID, branch, product, negative quantity and exact unit; its reservation is consumed; exact unit is sold; no active reservation remains. Labour-only jobs legitimately have no movement. Cost may be NULL. Invoice creation checks proof and fails `JOB_CONSUMPTION_UNVERIFIED` on inconsistency; it never tries to repair inventory.

### 4.2 Payments, allocation, overpayments and correction

**Decision: one payment belongs to exactly one invoice. No allocation table.** Partial payments are multiple positive payment rows on the invoice. Split tender is an atomic array of payment rows, one per method. A bank deposit covering several invoices is entered as explicitly split invoice-specific entries with the same external bank reference; no customer account deposit or cross-invoice allocation engine. A staff-visible duplicate-reference warning helps prevent repetition, but shared references cannot be globally unique. Managers cannot allocate to or inspect another branch.

Manual amount must be greater than zero, exact cents and no greater than the locked outstanding balance after earlier rows in the same transaction. Reject overpayment; do not clamp or silently create credit. Cash tendered/change may be displayed as transient UI arithmetic; only the invoice-settling amount is a payment. No cash-rounding adjustment in v1; confirm exact tender availability or use electronic tender.

Manual payment is immutable and immediately `succeeded` once staff confirms actual receipt, not a promise of bank settlement. Mistakes use one full `payment_reversals` entry against the original, then a replacement payment with a new request. Reversal requires reason and `payments.reverse`, is disallowed for Stripe and for any payment with refund history or a credit-funded payout obligation, and is not deletion or cash outflow. It reopens AR if appropriate. `first_payment_at` never resets, even after reversal; invoice totals stay locked. Reversal also generates a correction annotation/document event; original receipt remains historical.

### 4.3 Credit and refund semantics (authoritative algebra)

Scoped credit notes are required by master sections 26 and 29. They reduce only their source invoice's consideration/GST. They are not customer-wallet funds, future-purchase credit, unallocated money or a general ledger.

Let, in exact cents:

- `T` = current issued revision total, immutable after first successful payment.
- `C` = sum issued invoice credit notes (including cancellation adjustment, never greater than T).
- `G` = successful payments applied to this invoice, excluding full manual reversals.
- `A` = sum of immutable `authorised_refund_amount` on those credits: the portion promised as cash return rather than reduction of unpaid debt.
- `R` = currently effective successful ordinary refunds against those authorised payouts.
- `actual_net_cash = G - R` (abbreviated `N`) = actual net cash received; `E = T - C` = adjusted sale amount.
- `applied_to_sale = G - A`; `balance = E - applied_to_sale`; `refund_due = A - R`.

Enforce `0 <= R <= A <= G`, `0 <= A <= C <= T`, and `0 <= applied_to_sale <= E`; do not clamp an invalid ledger to zero. The distinction between an authorised cash return and a credit offset is essential for partially paid invoices. A pending cash refund must neither reduce existing receivables nor be presented as already paid. Invoice-scoped cash held for an approved refund is a liability, not an overpayment wallet.

Both amounts are derived, not stored status fields. `refund_due` is a liability tied to this invoice, never spendable on another invoice. Present original total, credits, gross paid, reversed, refunded, net paid, remaining and refund due separately. Do not label gross receipts as net paid.

An approved business refund first atomically issues a credit for the agreed line reduction and reserves a refund request against one original payment. Provider/manual payout is separate; failed/pending payout leaves the credit valid and the unpaid refund obligation visible. Retrying payout reuses that credit; never issue a second credit for the same approved reduction. A credit is not rolled back because Stripe/email is unavailable.

For each payout, maximum is the lesser of (a) the original successful payment minus its reversals, effective successful refunds and all in-flight/uncertain refund reservations, and (b) its credit note's authorised cash amount minus effective successful and in-flight/uncertain payouts against that credit. Approving a combined credit+refund adds the credit's reduction to C and its promised cash return to A atomically, validates the prospective algebra, then reserves payout rows under the same locks. To preserve a partially paid invoice's unpaid portion, a partial refund credit and its authorised cash amount both equal the requested payout; it does not silently waive the remaining balance. Full sale cancellation credits the entire remaining uncredited sale and authorises return of all receipts not already authorised for return. Split-tender full refunds are one approved credit with separate child payout requests for each payment. A payment with any refund history or outstanding credit-funded payout cannot be manually reversed; use incident-reviewed compensation if that original receipt was wrong.

Examples:

| Event | T | C | G | A | R | Balance | Refund due |
|---|---:|---:|---:|---:|---:|---:|---:|
| Paid invoice | 110 | 0 | 110 | 0 | 0 | 0 | 0 |
| Credit 22 approved, payout pending | 110 | 22 | 110 | 22 | 0 | 0 | 22 |
| That refund succeeds | 110 | 22 | 110 | 22 | 22 | 0 | 0 |
| Half-paid invoice, credit 22 / authorised cash 22 pending | 110 | 22 | 55 | 22 | 0 | 55 | 22 |
| Half-paid invoice, credit/refund 22 completed | 110 | 22 | 55 | 22 | 22 | 55 | 0 |
| Entire half-paid sale cancelled, credit 110/refund 55 completed | 110 | 110 | 55 | 55 | 55 | 0 | 0 |

Manual refund: staff first approves credit and records `pending`; only confirmation of actual cash/EFTPOS/bank payout with reference, date and reason marks `succeeded`. Never silently treat request creation as payout. Stripe refund goes back to original Stripe payment via provider API. Failed/uncertain API calls cannot be replaced with manual payout until provider non-success is proven, to avoid double refund. Only proven return of previously refunded funds to the merchant may remove that refund from effective R, restoring refund_due; preserve previous success evidence as specified in section 6. No provider fees are deducted from customer's approved refund and no fee/profit subsystem is added.

Unexpected external money (including an overpaying or unknown Stripe payment) is durably recorded as provider evidence/Needs Review, not discarded or forced onto AR. Resolution either matches the complete payment once all constraints hold, or returns the unmatched funds via a provider-evidence-linked refund. Such exceptional cash return has no sale credit and never changes invoice totals/stock. No partial allocation of a mismatched payment in v1. For exceptional returns, acquire a transaction advisory lock keyed by Stripe account/mode/PaymentIntent before locking its canonical evidence row; aggregate ALL returns across every event referencing that same provider payment. Successful plus pending/uncertain returns may never exceed the provider-confirmed received amount net of already observed external refunds. A returned/in-flight-return payment cannot later be matched to an invoice. Non-AUD evidence is retained for Admin provider-side resolution and verified closure; the AUD-only application never creates a foreign-currency refund record or applies it to AR.

**REFUND != STOCK RETURN.** Credit/refund RPCs have no inventory write grants/calls. A physical return needs the existing separately authorised stock process and suitable disposition; Phase 4 does not implement a new return engine or reverse captured COGS automatically.

### 4.4 Cancellation, revisions and locks

Store only `draft`, `issued`, `cancelled` on invoices. A draft is editable. First issue freezes a revision. A sent/unpaid issued invoice can be corrected through `revise_unpaid_invoice`: produce a new immutable revision under the same invoice number, increment revision/version, retain the old document, require a reason, and invalidate old checkout/queued delivery work. This honours the master editable-unpaid rule without rewriting a historical snapshot. Source job/quote is never modified by invoice edits.

Revision is forbidden after any successful payment, credit, pending payment/refund or unresolved provider evidence. It is also blocked until any old checkout is confirmed expired. Financial/customer/terms/line changes are revisions; private operational notes and delivery routing changes are separate audited metadata, never changes to issued content. Revision of a stock invoice cannot add/remove/change product identity or quantity, nor change original cost; only permitted discounts, customer-visible wording and allowed terms can vary. Product price remains source snapshot. Manual service lines can be edited before first payment.

Draft cancellation records reason, actor and time. Issued cancellation with no money, no pending provider work and no prior credits creates a full invoice-scoped cancellation adjustment/credit and marks cancelled atomically. Cancellation after payments follows full sale credit + all required refunds; only when E=N=refund_due=0 and no in-flight work may `cancel_invoice` mark cancelled. Do not label an invoice cancelled while owing the customer money. No separate `void` state; UI may explain cancellation as voiding. Numbers/history remain. Cancelled is terminal. An ordinary full refund can remain issued with derived Refunded badge; it need not also be cancelled.

### 4.5 Discounts, labour and pricing

One v1 discount model: **per-line percentage only**, `numeric(5,2)` from 0.00 to 100.00 inclusive. No fixed amount, whole-invoice discount, negative line, independent product-price override or stacking. A percentage applies once against the undiscounted snapshotted unit price × quantity. Labour remains free text; other charges use descriptive labour/service lines, not a new catalogue/type.

`discounts.apply` plus the relevant create/edit permission is required to create or change a positive discount. Reason is mandatory, trimmed/nonempty, max 500 characters. Admin can apply up to 100%; managers additionally obey an Admin-configured per-manager `finance_discount_limit_percent` (NULL/0 means no positive discount). Add that nullable exact numeric column to existing `manager_permissions`? **No:** that table has one row per permission and mixes grant data. Instead add `finance_discount_limit_percent numeric(5,2) null` to `user_profiles`, writable only through the existing Admin user-management server path and validated by a new private finance guard. Its meaning is a cap, not a grant. No manager is silently enabled. Selecting commercial caps is an activation/configuration decision, not an unresolved arithmetic design.

Add `discount_percent numeric(5,2) not null default 0`, `discount_reason text null`, `discount_actor_user_id uuid null`, `discount_authorised_at timestamptz null`, and `internal_note text null` to editable quote/job lines in a future additive migration. Existing totals and rows are not recalculated/backfilled. Discount provenance is copied quote→job→invoice without applying a second discount; unchanged previously authorised discounts can be carried by a user without discounts.apply only when the DB verifies the exact source line, product, quantity, base price and discount are unchanged. Any change to product, quantity, base price, line identity or positive discount requires the acting user's CURRENT discounts.apply permission and cap; provenance cannot be supplied/transplanted by the browser. Record base, rounded discount and net amounts, actor, cap and reason in audit. Global price editing stays governed by `inventory.edit_global_price` and cannot substitute for a per-sale discount check.

### 4.6 Exact GST and rounding

AUD only. Database NUMERIC is authoritative; RPC input money uses validated decimal strings, not browser totals. Reject more than two fractional digits for prices/payments/refunds and more than three for quantities, rather than allowing a NUMERIC cast to silently round invalid input. DB intermediate variables use unrestricted `numeric`; persist quantity `numeric(12,3)`, unit/line/document money `numeric(14,2)`, cost `numeric(14,4)`, discount percentage `numeric(5,2)`, tax rate `numeric(5,4)` fixed `0.1000`. Validate all ranges/overflow before commit.

For each standard-taxable line:

1. `base = round(quantity * unit_price_incl_gst, 2)`.
2. `discount = round(base * discount_percent / 100, 2)`.
3. `inclusive = base - discount`.
4. Unrounded GST component = `inclusive - inclusive / 1.10` = `inclusive / 11`.
5. Preserve Phase 3B total-invoice GST convention: `invoice_gst = round(sum(inclusive)/11,2)`, `subtotal_ex_gst = sum(inclusive)-invoice_gst`.
6. To show line GST that sums exactly, allocate invoice GST cents using floor of each nonnegative raw line GST in cents, then distribute remaining cents by descending fractional remainder, tie by line position/id. Store allocated line GST and `line_ex_gst = inclusive - allocated_gst`. This is deterministic; do not independently round every line and then contradict the header.

All v1 lines are taxable at 10%; no GST-free toggles/tax engine. PostgreSQL numeric round uses half away from zero (positive amounts therefore half up). Zero explicit price/total is allowed; NULL means pending. Draft pending price makes financial totals NULL and blocks issue/checkout/payment. Cost NULL never blocks an otherwise priced invoice. Display money to two decimals; JS preview may use existing integer/BigInt helpers but cannot authorise. Zero-total invoice is settled without a zero payment and receives no payment receipt.

Credit lines reference original invoice lines. User supplies positive inclusive reduction per line in cents, no more than remaining uncredited inclusive amount. Compute cumulative credit GST as `round(original_allocated_line_gst * cumulative_credit_inclusive / original_line_inclusive,2)`; current credit GST is cumulative target minus previously credited GST. Full remaining credit takes the exact remaining original line GST, eliminating repeated partial rounding drift. Zero-value lines cannot receive positive credit. Credits never exceed original line GST/value. Refund cash has no independent GST calculation; the credit document owns tax adjustment.

### 4.7 Terms, business date and aging

Business date = `(now() at time zone 'Australia/Adelaide')::date`. First issue uses current business date, not job completion or email-send date; no backdating UI. Calendar days: due_on_receipt = issue date; 7/14/30_days = issue date plus that integer. Individuals/walk-in forced due_on_receipt; businesses use snapshotted allowed terms. Invoice create/edit permission may select one of those terms for a business; no arbitrary due-date override. Unpaid revision retains original issue date and recalculates due date from its revised allowed terms, showing revision date separately. Terms/customer changes after issue do not silently change a document.

`days_overdue = business_date - due_date`. For issued invoices with positive balance: Current if <=0; 1–7; 8–14; **15–29**; **30+**. This explicitly replaces the master overlapping 15–30/30+ boundary. Overdue is derived, not scheduled into a status column. Customer balance is sum of visible-branch invoice balances; a manager never receives a hidden other-branch amount. Refund_due is shown separately, never netted across invoices/customers.

## 5. Final database model

### 5.1 Shared schema contract

The following is a specification, not executable migration SQL. Every listed table is proposed under `public`, has RLS enabled, and has direct privileges revoked from PUBLIC, anon, authenticated **and service_role** unless explicitly stated below. Reads and writes use defined RPC projections. Private helpers are unexposed and executable only by their controlled owner. No finance table permits direct application INSERT/UPDATE/DELETE. No cascading deletion of finance history or foreign-key parents. Existing auth/account removal must archive/disable rather than delete actors referenced by finance.

Notation: `?` means nullable; all other fields NOT NULL. UUID PKs default `extensions.gen_random_uuid()`. `money` = `numeric(14,2)`, nonnegative unless positive is specified. Common mutable records have `created_at/updated_at timestamptz default now()`, `version integer default 1 check >0`; append-only records have `created_at` and **no version/update timestamp** because no user edits are possible. Actor IDs reference `auth.users(id)` with RESTRICT; branch IDs reference `locations(id)`, customer IDs `customers(id)`, vehicle IDs `customer_vehicles(id)`, job IDs `jobs(id)`. All ordinary FK indexes are required even if not repeated in the table row. Entity references are validated as same invoice/location/customer by RPC plus composite FK/constraint triggers where applicable. All document/amount relationships also have DB constraint triggers; UI-only validation is insufficient.

No cached paid/balance columns; read RPCs calculate totals from finance rows under one consistent SQL snapshot. All writers first lock the invoice. Multi-column child FKs `(invoice_id,revision_id)` reference unique parent pairs to prevent mismatched ownership.

| Proposed table | Fields, relationships and constraints |
|---|---|
| `finance_settings` | PK `singleton boolean check true`; business_name, abn, address JSON, phone, shared_email, logo_asset_path, logo_sha256, bank_instructions JSON, invoice_footer; nullable until completed. `stripe_enabled`, `email_automation_enabled`, `reminders_enabled` booleans default false; `currency text` AUD, timezone Australia/Adelaide; `updated_by` actor?, common timestamps/version. Admin-only read/write RPC. No credentials. Issue guard requires complete verified identity/branch data. Snapshot copies values; settings are not document history. |
| `finance_location_settings` | PK/FK `location_id`; branch_name, address JSON, phone, contact_email, document_footer nullable until configured; updated_by actor?, timestamps/version. Exactly LON/REG settings as configured, no new branch or fake identity seed. Admin-only; invoice issue snapshots required values. |
| `invoices` | PK id; invoice_number text UNIQUE regex `^(LON|REG)-INV-[0-9]{6,}$`; location_id; customer_id?, customer_vehicle_id?, job_id? UNIQUE; source_type text `job,pos,manual`; status `draft,issued,cancelled`; current_revision_id UUID? FK invoice_revisions (deferred creation transaction); first_issued_at?, first_payment_at?, cancelled_at? timestamptz; cancelled_by actor?, cancellation_reason?; operational_notes? text; reminders_suppressed boolean false, suppression_reason?, delivery_email_override?; created_by actor; timestamps/version. `job/pos` requires job_id, manual forbids it; source customer/vehicle/location checked against job. Current revision required at transaction end. Cancellation fields required only when cancelled. Index(location_id,status,created_at,id), (customer_id,location_id). Metadata audit on every change; identity and first_* timestamps immutable once set. |
| `invoice_revisions` | PK id; invoice_id FK; revision_number integer >0; UNIQUE(invoice_id,revision_number), UNIQUE(invoice_id,id); lifecycle `draft,issued`; issued_at? timestamp; issue_date?, due_date? date; payment_terms allowed four values; currency AUD; business_snapshot/customer_snapshot/branch_snapshot JSON; billing_contact_snapshot?, vehicle_snapshot? JSON; customer_reference?, customer_notes?; source_job_number?, source_quote_number? text; total_incl_gst?, subtotal_ex_gst?, gst_amount? money; pricing_complete bool; revision_reason?; created_by actor; timestamps/version while draft. Issued row update/delete prevented by trigger, including snapshots/version/timestamps. Draft→issued only after complete validated lines. Index(invoice_id,issued_at), (due_date,invoice_id). JSON exact key allowlists defined in section 5.2. |
| `invoice_lines` | PK id; invoice_id + revision_id composite FK; position integer >0 UNIQUE(revision_id,position); source_job_line_id? FK job_lines; product_id? FK products; used_tyre_unit_id? FK used_tyre_units; line_type product/labour; description text nonempty; quantity numeric(12,3)>0 (product integral); unit_price_incl_gst? money; discount_percent numeric(5,2) 0..100; discount_reason?, discount_actor_user_id?, discount_authorised_at?; base_incl_gst?, discount_amount?, total_incl_gst?, gst_amount?, subtotal_ex_gst? money; gst_rate numeric(5,4)=0.1000; created_at. No independent version: parent's version controls drafts. Issued parent makes all fields immutable. Products only with verified source job line; manual labour has no product/unit/source. Internal labour note is excluded from document payload. |
| `invoice_line_costs` | PK/FK invoice_line_id; inventory_movement_id? FK inventory_movements; source_job_line_id? FK job_lines; captured_unit_cost? numeric(14,4), captured_quantity numeric(12,3)>0; capture_source text `job_consumption,not_applicable`; created_at. Append-only; no provider/customer linkage except through line; no version. NULL retained for unknown/not_applicable with distinct source. Only cost-authorised read RPC may project values; never standard invoice/PDF/email. No future WAC joins. |
| `finance_action_requests` | PK request_id UUID supplied; action text constrained to implemented finance mutations; actor_kind `staff,stripe,worker`; actor_user_id? required iff staff; location_id?; entity_type? text/entity_id? UUID; payload_hash text SHA256; result JSON; created_at. Append-only successful command results; UNIQUE PK global; index(actor_user_id,created_at). No general read grants. Failed transactions roll this back. Provider inbox survives separately. Hash normalised server/DB input including actor/action/version/target. |
| `payments` | PK id; invoice_id, invoice_revision_id composite FK; location_id, customer_id? checked against invoice; method `cash,eftpos,bank_transfer,stripe`; amount money >0; currency AUD; status `pending,succeeded,failed`; reference?, notes?; received_at? timestamptz; stripe_checkout_id? FK stripe_checkouts, provider_account_id?, provider_payment_intent_id?, provider_charge_id? text; livemode? bool required for Stripe; created_by actor? (NULL only provider); first_provider_event_id? FK provider_events; request_id UUID UNIQUE; timestamps/version. Manual insert only succeeded; Stripe pending→succeeded/failed, failed→succeeded only from newer verified provider truth. Success cannot be downgraded by stale events. UNIQUE(provider_account_id,livemode,provider_payment_intent_id) and equivalent charge key WHERE non-null. Index(invoice_id,status,created_at), (location_id,received_at). Core identity/amount immutable; transitions audited. |
| `payment_reversals` | PK id; payment_id UNIQUE FK; invoice_id/location_id checked; amount money >0 exactly full original amount; reason text required; reversed_by actor; request_id UUID UNIQUE; created_at. Append-only no version. Manual-only and no refundable/in-flight conflict. Reversal does not change original payment row. Index(invoice_id,created_at). |
| `credit_notes` | PK id; credit_number text UNIQUE branch CRN format; invoice_id/current locked invoice_revision_id composite FK; location_id/customer_id?; reason text; kind `sale_reduction,cancellation`; total_incl_gst/subtotal_ex_gst/gst_amount money; authorised_refund_amount money NOT NULL default 0, constrained 0..total_incl_gst; status fixed `issued`; issued_at timestamptz, issue_date date; immutable business/customer/branch snapshot JSON; created_by actor; request_id UUID UNIQUE; created_at, no version. Total >0, <= remaining invoice/line values; authorised_refund_amount contributes A and distinguishes promised payout from AR reduction. Append-only, indexed(invoice_id,issued_at). No standalone transferable credit/account balance. |
| `credit_note_lines` | PK id; credit_note_id FK; invoice_line_id FK, position integer; UNIQUE(credit_note_id,position), UNIQUE(credit_note_id,invoice_line_id); description snapshot; inclusive_reduction money>0, gst_reduction money>=0, ex_gst_reduction money>=0; created_at. Append-only/no version. Enforce invoice/revision match and cumulative reduction ceilings under invoice lock. |
| `refunds` | PK id; invoice_id?/location_id?/customer_id?; payment_id? FK; credit_note_id? FK; unmatched_provider_event_id? FK provider_events; exact money amount>0, currency AUD; method `cash,eftpos,bank_transfer,stripe`; status `pending,succeeded,failed,cancelled,needs_review`; provider_account_id?/provider_refund_id?/provider_payment_intent_id? text, livemode?; provider_status? text allowlisted; reason; manual_reference?; requested_by actor?; confirmed_by actor?; requested_at, succeeded_at?, failure_confirmed_at? timestamptz; success_provider_event_id?, failure_provider_event_id?, last_provider_event_id? FK provider_events; request_id UUID UNIQUE; timestamps/version. Ordinary flow requires invoice/payment/credit, matching branch; exceptional return of wholly unmatched provider funds requires unmatched_provider_event_id and no payment/credit, Admin approval. UNIQUE(account,livemode,provider_refund_id) partial. Index(payment_id,status),(credit_note_id,status),(invoice_id,status),(status,updated_at),(provider_account_id,livemode,provider_payment_intent_id). Immutable amount/target; succeeded_at and success event never cleared. Verified returned-funds transition records immutable failure timestamp/event and appends audit. In-flight reservations include pending/needs_review. |
| `stripe_checkouts` | PK id; invoice_id/revision_id composite FK; location_id; requested_by actor; amount money>0/currency AUD; provider_account_id text; livemode bool; provider_session_id?, provider_payment_intent_id?, hosted_url? text; provider_expires_at?, revoked_at?, last_checked_at?; status `creating,open,expiring,expired,completed,failed,needs_review`; request_id UUID UNIQUE/provider_idempotency_key text UNIQUE; request_hash; timestamps/version. Unique account/mode/session ID and one active checkout per invoice WHERE status creating/open/expiring/needs_review. Hold entire requested outstanding amount. Only trusted DB worker changes provider state; hosted URL not exposed through general query lists/audit. Index(status,updated_at). |
| `provider_events` | PK id; provider text fixed stripe; provider_account_id, livemode bool, event_id text; UNIQUE(provider,account,livemode,event_id); event_type, provider_object_id, provider_created_at timestamptz; received_at; validated_payload JSON (minimal allowlist, not raw card/complete event dump); payload_sha256; invoice_id?/location_id? resolved server-side; processing_state `received,processed,needs_review,ignored`; reconciliation_state `matched,needs_review`?; reason_code?; attempt_count int>=0; processed_at?, reviewed_by?, reviewed_at?, review_reason?; lease_until? timestamptz; timestamps/version. Raw arrival evidence immutable; processing envelope guarded. Unknown invoice leaves FKs NULL. Branch readers cannot see unassigned events; Admin only. Index(processing_state,received_at),(invoice_id,received_at). Provider event replay cannot create a second payment/refund. |
| `financial_documents` | PK id; invoice_id/location_id; invoice_revision_id? FK; payment_id? FK; credit_note_id? FK; refund_id? FK; document_type `tax_invoice,receipt,credit_note,refund_confirmation,payment_correction`; document_number text? UNIQUE (invoice uses invoice number + revision identity, not a second unique invoice-number assignment); source_key text UNIQUE; snapshot JSON (safe allowlist); template_version text; content_sha256?; storage_path? UNIQUE; render_status `queued,rendering,ready,failed`; render_error_code?; created_by actor?; rendered_at?; timestamps/version. Exactly one appropriate source FK for type, with invoice relation validated; invoice PDF unique(invoice_revision_id,document_type). Receipt RCT number allocated once per successful payment; no new table needed. Snapshot immutable at creation; only rendering envelope changes. |
| `email_deliveries` | PK id; invoice_id/location_id; document_id? FK financial_documents; checkout_id? FK stripe_checkouts; reminder_delivery_id? deferred FK; type `invoice,receipt,payment_link,credit_note,refund_confirmation,payment_correction,reminder`; recipient text; sender_snapshot/reply_to/subject text; template_version, payload_snapshot JSON, payload_sha256; idempotency_key text UNIQUE; provider_message_id? text UNIQUE; status `queued,sending,sent,failed,needs_review,suppressed`; attempt_count integer>=0; next_attempt_at?, lease_until?, sent_at?, safe_error_code?; requested_by actor?; timestamps/version. Valid source combinations enforced; recipient/payload immutable after first attempt. One invoice/branch owner. Index(status,next_attempt_at),(invoice_id,created_at). No provider secret in snapshot. |
| `email_delivery_attempts` | PK id; email_delivery_id FK; attempt_number int>0 UNIQUE(delivery_id,attempt_number); started_at timestamptz; finished_at?; outcome `sending,accepted,rejected,unknown`; provider_message_id?; safe_error_code?; request_hash; created_at. Outcome can be filled once from sending; thereafter immutable. No version (worker lease validates finalisation); no actor/customer duplications (inherit delivery). Never overwrite an old attempt on retry. |
| `reminder_deliveries` | PK id; invoice_id/location_id; stage text `before_due_3,due,overdue_7,overdue_14`; UNIQUE(invoice_id,stage); scheduled_for date; invoice_revision_id FK; status `scheduled,claimed,sent,failed,skipped,suppressed,needs_review`; email_delivery_id? UNIQUE FK; skip_reason?; attempt_count int>=0; lease_until?, sent_at?; timestamps/version. Claimed worker system actor through audit, no staff actor column needed. Index(status,scheduled_for),(invoice_id,stage). Revisions may reschedule an unsent stage but never recreate/re-send a sent/skipped stage. |

Deferred circular references (`invoices.current_revision_id`, email/reminder pairing, Stripe/event/payment relationships) must be explicitly declared DEFERRABLE where creation order requires them; never disable constraints to insert. Specifically, invoices.current_revision_id stays nullable for construction, with composite FK `(id,current_revision_id) REFERENCES invoice_revisions(invoice_id,id) DEFERRABLE INITIALLY DEFERRED` and a deferred constraint trigger requiring it non-null for every surviving invoice at commit. A scalar revision FK alone is insufficient. Cross-table checks use deferred constraint triggers plus the documented lock order. Provider IDs are scoped to account and mode to prevent test/live collisions. No payment-allocation, customer-credit, receivables cache or new audit table is proposed.

### 5.2 Immutable snapshot contract

At first issue/revision: validated `business_snapshot` has schema_version, legal/display name, ABN, address, phone, shared email, logo storage path+SHA, bank/payment instructions, invoice footer, timezone/currency. `branch_snapshot` has location UUID, code/name, address/phone/contact email/footer. Customer snapshot has linked ID/type or walk-in label, display/legal/company name, ABN where available, billing address parts and configured terms. Billing contact snapshot has contact ID?, name, email and phone. Vehicle snapshot has ID?, registration, make/model/type, fleet number and description. Copy customer PO/reference and source quote/job number. Never include internal customer/technician notes or VIN unless explicitly selected for a legitimate document purpose.

Document issue requires actual approved business identity and ABN; do not infer ABN from web branding. Walk-in uses nullable customer_id and `Walk-In Customer`, matching Phase 3B. For a tax invoice requiring buyer identity (notably AUD 1,000+), capture actual recipient identity/ABN as invoice-specific billing snapshot if no customer row exists; never treat the generic Walk-In label as sufficient. This need not create a fake master customer.

Invoice lines snapshot description, quantity, base unit price, discount/reason, tax rate, net inclusive/GST/exclusive totals. Cost copy comes exclusively from the completed job into restricted invoice_line_costs. The invoice PDF has fixed issue-time amounts; paid/refunded/current balance appears in separate current UI/receipts/statements, not by rewriting the original tax invoice PDF. Receipts snapshot payment amount/method/date/reference, invoice number/revision and balances at that payment, explicitly labelled as of that time. Credit notes snapshot adjustment reason, original reference, changed amounts/GST and identity; refund confirmations describe payout status only after confirmed success.

## 6. State machines

### Invoice

`draft → issued → cancelled`; also `draft → cancelled`. Draft mutations increment version. Issue locks revision/lines; unpaid revision creates a new issued revision without changing header state. Cancelled is terminal. Paid state, overdue state and delivery state are not stored on invoices.

Derived badges are separate axes:

- Payment: unpaid (applied_to_sale=0,E>0), partially_paid (0<applied_to_sale<E), settled (balance=0; includes zero-total), with refund_due shown independently when positive.
- Refund: none, partially_refunded (effective R>0 but not all original sale credited/refunded), refunded (C=T, N=0, no pending payout; may coexist with cancelled).
- Due: current/overdue only for positive balance.
- Delivery: latest document email pending/sent/failed, independent of issue.

Never let a display label drive ledger writes. Once `first_payment_at` is set, price/identity/terms revisions stay locked forever, even if manual payment is later reversed.

### Payment

Manual: insert succeeded; derived reversed if reversal row exists. Stripe: pending→succeeded or failed; failed→succeeded only verified provider success, never from browser/manual mark-paid. A succeeded payment is immutable; partial/full refund and reversal are derived from linked rows. Receipt queued only once on first success, not on event replay. Reconciliation state is a separate provider evidence decision, not a fake payment status. Mismatched money is not applied to an invoice.

### Refund

`pending → succeeded | failed | cancelled | needs_review`; `needs_review → pending | succeeded | failed` after authoritative lookup; failed payout can be retried with a new payout request against the same outstanding credit only after prior terminal failure is proven. Duplicate request uses original result. Do not retry a provider success using a new idempotency key. Exceptional transition `succeeded → failed` is allowed ONLY after current provider lookup plus provider balance-transaction evidence proves the money was returned to the merchant, not merely because a later-delivered event says failed. Keep succeeded_at/success_provider_event_id forever, set failure_confirmed_at/failure_provider_event_id once, and append audit evidence. Contradictory events without proof become Needs Review evidence while effective success remains unchanged. Confirmed return removes that refund from effective R and restores refund_due; it never erases prior cash history or changes AR. Manual succeeded is terminal; any later correction needs incident-reviewed compensation. A timeout before confirmed payout remains needs_review/reserved.

### Email/reminder

Email: queued→sending→sent or failed/needs_review; failed→queued on bounded retry; queued→suppressed when no longer eligible. Sent means provider accepted, not guaranteed inbox delivery. Unknown acceptance remains needs_review and is never automatically resent outside provider deduplication coverage. Reminder: scheduled→claimed→sent, failed, skipped, suppressed or needs_review. Retry reclaims the same row/email. Sent/skipped are terminal for a stage; paid/cancelled suppresses unsent work. Changing recipient requires a new explicitly audited delivery intent, except an unattempted queued envelope may be superseded before send, retaining old evidence.

## 7. Atomic transactions and lock discipline

No transaction spans Stripe/Resend HTTP or PDF rendering. DB commits durable intentions/outbox first. Remote response finalisation is a second narrow RPC. Business state survives provider/document failure.

| Operation | Required database transaction |
|---|---|
| Create from completed job | Validate actor/key/hash; acquire finance request advisory lock; lock authorised job; verify completion proof; reject existing invoice (return prior only exact replay); allocate INV via general numbering helper; create draft/revision/lines/costs from snapshots; audit; persist request/result. No inventory call. |
| Complete and invoice | Authorise jobs.complete + invoices.create (+jobs.view/invoices.view for returned detail); lock outer request; derive stable child UUID from outer key/action/job and acquire its sales-request advisory lock BEFORE locking job; call released `public.complete_job` within same transaction with reentrant locks; create invoice via private finance helper; audit/result. Any failure rolls back completion, movements, reservations, number, invoice and both request records. |
| POS finalise | Validate pos.use and jobs.create/edit/complete, invoices.create/issue, payments.record where manual tender present. Stable outer key and children; create/update job using released functions; call completion; snapshot/issue; post tender array sequentially under invoice lock; queue document intents; audit/result. Existing draft POS job is locked/version checked; client carries stable job/request IDs. Do not use separate server-action commits for these steps. |
| Edit/issue/revise | Actor/location/request lock; invoice FOR UPDATE; expected version; guard state/first payment/checkout; validate and calculate exact inputs; persist draft or immutable new revision; audit before/after/delta; allocate immutable PDF intent on issue. No HTTP. |
| Manual payment/split | Request lock; invoice FOR UPDATE; version, state and checkout reservation guard; compute AR from ledger; validate all tender entries and sum; insert succeeded rows; set first_payment_at if unset; increment invoice version once; create receipt intents; audit/result. |
| Manual reversal | Invoice then payment lock; enforce full reversal/manual/no refunds/no checkout; insert reversal; recalculate projection; increment invoice version; correction audit/document intent. |
| Credit/refund approval | Invoice then payment rows sorted UUID; calculate line credit caps; insert immutable credit/lines and refund requests; reserve maximums; increment invoice version; audit/result; queue credit document intent. No payout API inside transaction. |
| Refund completion | Invoice then payment/refund locks; verified provider or authorised manual proof; guard transition/current provider truth; set effective payout state; increment invoice version; audit; queue refund confirmation only success. No stock writes. |
| Webhook | Verify signature on raw HTTP body first; ingest unique provider event via service-only RPC; then processing transaction locks resolved invoice, checkout/payment/refund; validate account/mode/currency/amount/metadata and provider current state; upsert success once, audit and receipt outbox together; mark processed/matched or needs_review. Respond 2xx only after durable event acceptance. Processing failure is recoverable from inbox. |

Global lock order: outer finance request advisory lock → ALL required deterministic child `sales-request:` advisory locks in sorted key order → source job when relevant → invoice(s) in UUID order → checkout/payment rows in UUID order → credit/refund rows → document/outbox rows. Acquire child locks BEFORE the job: released complete_job itself takes the child request lock then the job lock; its nested reacquisition is transaction-reentrant. This applies to POS create/update/complete composition as well. Already-completed job invoicing has no child sales locks or completion call. Existing completion owns its reservation/unit/balance lock order; do not acquire inventory locks in finance before calling it. Test an adversarial standalone complete_job call using a derived child UUID, not just normal UI traffic. Provider-only unmatched-return locking has no job/invoice dependency; lock its account/mode/PI advisory key first, then evidence/refund rows. No path may take that provider key after an invoice lock.

Optimistic `p_expected_version` required on every staff update/issue/payment/refund/reversal/cancel/reconcile and checked after lock. Exact idempotent replay is resolved after current authorization and matching actor/action/hash, before stale-version rejection. Replay cannot leak another actor's result. Read-only details use a consistent statement snapshot. Return `INVOICE_VERSION_CONFLICT` with reload/review UI, never silent last-write-wins. Deadlock/serialization retry is bounded and uses the same request ID; monetary validation conflicts require staff review, not blind automatic retries.

## 8. Idempotency model

Client generates a UUID once per user intent and retains it across submit/network retry; server must not silently create a new UUID on every retry. Form payload canonicalisation covers action, actor, entity, expected version, ordered lines/tenders, amount/currency and reason. Same UUID/different payload returns `IDEMPOTENCY_KEY_REUSED`. A successful replay still requires access to the location. Requests are durable; no in-memory-only dedupe.

| Intent | Durable key(s) |
|---|---|
| Invoice create/manual/from-job | finance_action_requests.request_id + action/actor/hash; invoices.job_id UNIQUE where present |
| Issue/revision/cancel | finance request + expected version; unique invoice/revision; one PDF source_key |
| POS | outer finance UUID; deterministic create/update/complete child IDs; invoice job uniqueness; deterministic per-tender request UUID |
| Manual payment/reversal | finance UUID; payments.request_id UNIQUE; payment_reversals.payment_id UNIQUE |
| Checkout | local stripe_checkouts UUID before API; provider key `checkout/{mode}/{local-id}`; one active invoice checkout; unique provider session |
| Webhook/payment | provider_events unique(account,mode,event); payments unique(account,mode,PaymentIntent) and charge; event ID alone is insufficient when different events describe one payment |
| Credit/refund | credit request UUID; child refund UUID; provider key `refund/{mode}/{refund-id}`; unique provider refund ID; invoice+payment capacity locks |
| Document | source_key = type/source UUID/revision/template version; old snapshots retained; receipt payment uniqueness |
| Email | immutable delivery UUID-derived key, payload hash, provider message ID; repeated Retry Email shares intent until proven new delivery required |
| Reminder | UNIQUE(invoice_id,stage), not cron invocation or current date; same email intent reused across retry |

## 9. Permissions, RLS and trusted boundaries

Final new PermissionKey additions (identical TS union/labels/grantable registry and SQL check):

| Permission | Actions/read surface | Manager scope / Admin |
|---|---|---|
| `invoices.view` | List/detail/revisions and authorised document downloads; source integration links | Own branch / both |
| `invoices.create` | Draft from job/manual; combined completion additionally jobs.complete | Own branch / both |
| `invoices.edit` | Draft or unpaid revision; requires invoices.view; no post-payment financial edit | Own branch / both |
| `invoices.issue` | Issue/reissue and business POS account invoice | Own branch / both |
| `invoices.cancel` | Financial cancellation under rules, mandatory reason | Own branch / both |
| `payments.view` | Payment/refund/receipt timelines; payment-sensitive fields separate from invoice list aggregates | Own branch / both |
| `payments.record` | Actual manual payment/split; checkout initiation against visible invoice | Own branch / both |
| `payments.reverse` | Full manual payment correction with reason | Own branch / both |
| `payments.reconcile` | See reconciliation, trigger verified provider refresh, match exact known branch evidence | Own branch / both; unknown evidence/exceptional unmatched refunds Admin-only |
| `refunds.create` | Approve scoped credit/refund and confirm manual payout; requires invoices.view + payments.view | Own branch / both |
| `receivables.view` | Operational AR/customer outstanding visible branch, invoice summaries/aging/reminders | Own branch / both |
| `discounts.apply` | Positive per-line discount changes with cap and commercial mutation permission | Explicit grant AND configured cap / 0–100% |
| `documents.send` | Send/retry invoice/receipt/link/credit/refund, delivery override/suppression; also source read permission | Own branch / both |

All mutations also require view permission for the target, including invoices.view for creation; permission administration shows this dependency and does not imply an automatic grant. Receipt access additionally requires payments.view; credit/refund amounts similarly. AR aggregate permission does not implicitly grant full invoice PII/payment references; links show only if invoices.view. Existing `inventory.view_cost` independently gates invoice_line_costs; invoices.view does not imply it. Admin role override never bypasses state, amount, idempotency or inventory safety rules. In v1, granting refunds.create intentionally permits the same manager to approve and confirm a refund up to the full mathematically refundable amount in their branch; there is no implicit second-approver workflow. Show that consequence in Admin permission configuration and require explicit grant selection before activation. No manager refund permission is seeded.

Global finance settings, Stripe/Resend/bank settings and manager cap configuration are **hard Admin-only**, no grantable integration keys. Settings pages show secret configured/not-configured indicators only; secret entry/rotation stays in authorised deployment secret management, not SQL/form logs.

Every table in section 5: RLS on, no application direct writes, no anonymous read. Staff read RPCs enforce active actor, correct permission and branch; all returned JSON is explicit allowlist, never row_to_json on a cost/provider table. RLS select policies mirror parent ownership and appropriate view permission even though direct grants are withheld, as defence in depth. Settings require Admin; cost rows require invoice view + cost permission; action requests/attempt/inbox have no general user policy. Unknown provider events require Admin. Service_role table privileges are deliberately revoked for these new objects; service-only RPCs are narrowly scoped by implementation ownership even though the deployment key itself remains powerful.

Function grants are exhaustive by family:

- Public staff functions listed in section 16: revoke EXECUTE from PUBLIC, anon and service_role; grant authenticated; SECURITY DEFINER `SET search_path=''`; schema-qualify all names; auth.uid/current active profile authorisation; never accept authoritative actor/role from client.
- Public provider/worker functions listed in section 16: revoke PUBLIC, anon, authenticated; grant service_role only; no generic dynamic SQL/table name/payload write; validate targeted provider inputs and enabled capability. They use system/provider actor semantics, not a forged staff session.
- All private helpers (finance authorisation/math/numbering/snapshot/credit/claim implementations): revoke all exposed-role EXECUTE; controlled owner only. Explicitly qualify calls. Do not change global default privileges used by unrelated applications.
- `audit_events`: reuse append-only insertion privileges/helper pattern; finance helpers insert through controlled owner. No audit UPDATE/DELETE grants and no broad details projection.
- Private `finance-documents` storage bucket (future): no anon/authenticated direct object writes/listing; server upload only, staff reads through document-authorising endpoint, short-lived signed URL at most 60 seconds after authorisation or streamed response. Cost/internal fields never in PDF; no public bucket.

## 10. Stripe hosted payment architecture

Use Checkout `mode=payment`, AUD, card payment methods only, one line representing the approved invoice's full outstanding balance. Do not create recurring subscriptions, Stripe Invoicing, Payment Links product objects, automatic tax, coupons or raw card forms. Partial/split settlement can precede checkout using manual payments; checkout collects the then-current remaining balance. No browser editable payment amount.

1. Staff server action/POST authorises invoice + payments.record; DB reserves current outstanding balance and creates `stripe_checkouts` in creating state with expected revision/version, account/mode and stable idempotency key.
2. Server sends Checkout create request using exact integer cents; metadata on Session and PaymentIntent includes local checkout UUID, invoice UUID, branch UUID, revision UUID, environment marker. Return URLs are fixed allowlisted application URLs, never user-supplied. Session expiry is 30 minutes from creation, within the provider-supported range verified at implementation.
3. Persist returned Session ID, expiry and hosted URL via compare-and-set finaliser. Client redirects to the provider URL only after durable finalisation. A timeout preserves creating/needs_review and retries the same provider key/current lookup. Never issue a second session on uncertainty.
4. An active checkout holds the entire outstanding balance: block manual payment, revision, cancellation, credit/refund affecting that invoice until provider expiration/nonpayment is confirmed or settlement is recorded. UI provides Revoke link, which sets expiring, calls provider expire, then releases hold only after confirmed expired/unpaid. If payment won the race, process it first. Local expiry alone cannot prove nonpayment.
5. Customer receives Stripe's high-entropy hosted URL, not an invoice-ID-authorised public app page. No public invoice lookup/API. Success/cancel page is generic with no PII; visiting it cannot mutate state or prove payment. Show “Payment processing; confirmation will be sent after verification.” Staff invoice page polls its authorised state. This avoids building another public capability-token system.
6. Webhook raw body signature verification occurs before JSON parsing using the official SDK and configured endpoint secret; reject invalid signature with 400. Validate expected Stripe account/mode, API event shape, currency, integer amount, all metadata, stored Session/PaymentIntent relationship and current invoice obligation. Separate test/live keys/secrets; live disabled by default.
7. Record event uniquely before processing. Handle `checkout.session.completed`, `.expired`, `.async_payment_succeeded`, `.async_payment_failed`, `payment_intent.succeeded`, `.payment_failed`, and refund created/updated/failed signals as applicable to pinned API version. For settlement, retrieve current provider objects where necessary; completed Session with unpaid status is not success. Repeated/different events for same PaymentIntent produce one payment. Current provider object state wins over delivery order; timestamps alone are insufficient.
8. Unknown invoice, wrong revision/amount/currency/mode, duplicate different successful PaymentIntent, impossible metadata or externally initiated dispute/refund becomes Needs Review. Preserve exact funds evidence and reasons; do not auto-clamp, silently mark paid, auto-reassign branch, or generate a balancing payment. Known exact match may be retried by a branch-authorised reconciler; unknown/cross-branch intervention is Admin-only, reason required. Monetary provider truth cannot be manually overwritten.
9. Known provider refund events update an existing refund by ID; external dashboard refunds create review evidence for Admin to confirm the scoped credit/payout relationship. Dispute events place evidence in Needs Review and hold new refunds/checkout until reconciled; Phase 4 does not implement a chargeback accounting suite or pretend disputed funds never existed.

Webhook receipt and processing are separated for durable recovery. 2xx means event safely in inbox, not necessarily matched. DB unavailable before durable ingest yields 5xx for provider retry. Protected reconciliation action and the authenticated finance worker drain received events; processing does not depend on the browser. Never drop unexpected successful cash events simply because ordinary overpayments are rejected.

## 11. Resend, recipients and delivery recovery

Inventory has its own server-only Resend adapter (`lib/finance/email.ts`); one approved sender for both branches, snapshotted into each delivery. Branch identity/reply contact appears in content. Configure independently from public website enquiry/member mail.

Recipient resolution at issue: invoice explicit billing selection/override → active billing contact email (prefer primary billing contact, otherwise stable created_at/id order) → customers.billing_email → accounts_email → email. If several billing contacts exist, display chosen recipient for staff confirmation; never broadcast all contacts by default. Snapshot the selection. Scheduled reminders use current authorised invoice delivery override or issue snapshot, not silent refresh to a newly edited customer address. No-email creates visible suppressed/not-sendable work, not a successful send. Syntactically invalid addresses block send and give staff a safe correction action. Known hard-bounce/complaint suppression from provider evidence prevents automatic retries to that address; a corrected recipient needs audited confirmation.

Emails are transactional only, with no marketing content or marketing-consent inference. `reminders_suppressed` plus reason supports an explicit customer reminder opt-out/branch operational pause; it does not erase debt or suppress a staff-requested invoice/receipt. No consent data is invented. Default reminders remain globally off until owner activation. Do not silently reactivate suppressed invoices after payment reversal.

Outbox flow: financial transaction enqueues immutable document intent; sending action/worker ensures PDF ready, commits email intent, claims lease and appends attempt, calls Resend, then records provider acceptance or failure. Send failure never changes invoice/payment/refund validity. Staff sees safe code, attempt times, recipient, actor and Retry Email. Never expose provider raw responses/secrets.

Resend idempotency currently lasts 24 hours. Use the same key/payload for automatic retries within that window (earliest eligibility after 1, 5, 30 minutes, then 2 hours; at most five attempts including initial). These are retry not-before times, not extra cron schedules: the daily worker or an authorised Retry Email invocation processes eligible work when running; no guaranteed minute-level background execution is promised. A definite rejection can safely become failed and be retried after correction as a new explicit intent. An unknown acceptance/timeout is retried only with same key while coverage is valid; after 24 hours it becomes needs_review. Retrieve provider evidence where possible. Do not promise exactly-once delivery across an unbounded crash window: if provider cannot establish whether it accepted the original, suppress automatic resend and require staff's explicit “send another copy” acknowledgement. Preserve both intents. A sent reminder stage never repeats automatically. `sent` means accepted by Resend, not inbox delivery; external delivery/bounce evidence may be recorded without invalidating the accepted attempt.

## 12. Reminder scheduler

Future endpoint `/api/cron/finance` is authenticated with exact `Authorization: Bearer <CRON_SECRET>`, missing/mismatched secret fails closed in all environments. Server-only secret, constant-time safe comparison, no token in URL/logs. No normal staff browser session substitutes for cron authority. A single daily UTC schedule (proposed `0 23 * * *`) produces an Adelaide business-morning execution across DST; eligibility uses the Adelaide date, not UTC and not an assumption of fixed UTC+9:30. Actual schedule registration is a later explicitly authorised deployment action.

Algorithm per bounded batch:

1. Check global reminders/email activation; obtain current Adelaide date once for batch. Drain durable inbox/outbox recovery within execution budget before/alongside scheduling; each work type has independent bounded claim limits.
2. Select issued positive-balance invoices in due-stage windows; no cancelled/settled/suppressed, review-held or invalid/no-recipient invoice. Four durable stage rows per issue are created/upserted, never delete/recreate them on cron retry.
3. Stage due dates: due-3, due, due+7, due+14. Pre-due stage whose date predates issue is skipped. Delayed cron sends at most the latest currently eligible unsent stage; older unsent stages are marked skipped/superseded so recovery cannot burst four emails. Due stage valid until overdue_7; overdue_7 until overdue_14; overdue_14 is a single final stage, never weekly recurrence. Future stages remain scheduled.
4. Select candidate IDs without pre-locking reminder rows; acquire applicable request and invoice locks in the global order before claiming document/outbox rows with `FOR UPDATE SKIP LOCKED`, a lease and a fencing token/version. Recheck eligibility under the invoice lock; upsert one email intent with deterministic stage key. Workers use short DB transactions, not locks held over HTTP.
5. Before external send, re-read current invoice balance/state, override and suppression; if paid/cancelled, suppress unsent work. Document amount is a freshly snapshotted as-of balance, not old job total. There remains an unavoidable last-millisecond race with external email acceptance; the dispatch claim is the linearisation point. Payment/cancellation prevents any later claim/retry, but cannot recall a message already in flight. Template says disregard if recently paid.
6. Send/finalise via shared Resend outbox with lease fencing. On success mark reminder sent; on known failure keep same intent and retry rules; on uncertainty needs_review. Crash/lease expiry does not justify a new provider key.
7. One invoice failure does not abort other claims. Time budget exhaustion leaves work durable for next run/manual authorised retry. Include backlog/last-run age in Admin operational health, not Phase 5 reporting.

Unpaid revision: recompute schedule only for unsent/unclaimed stages under invoice lock, invalidate unsent old-revision envelope, retain sent/skipped stages. Once any reminder has been claimed for external dispatch or sent, payment terms/due date cannot be changed by revision; ordinary content revisions remain available under financial rules. This preserves invoice-level stage uniqueness and the approved cadence. A positive balance reopened by reversal makes the latest still-unsent eligible stage immediately available, including overdue_14 after day 14. If every stage was already sent/skipped, show a mandatory “Reopened debt — staff follow-up required” operational flag derived from reversal time and delivery history, clearable only by an audited manual send/follow-up reason; do not invent a fifth automatic reminder stage.

## 13. Document generation

Use a deterministic server-side PDF renderer (proposed `@react-pdf/renderer`, pinned and validated against Node 22/Next runtime during implementation) with local approved branding/font assets. No remote HTML/URL rendering, arbitrary image fetch or customer HTML. Persist immutable bytes in private `finance-documents`; record SHA256 and template version. App route may show generation pending and retry; invoice issue remains valid if rendering fails. Do not require Chromium in production merely to print invoices.

Document set: Tax invoice per issued revision; receipt per succeeded payment; payment-link email (not a tax document); invoice-scoped credit/adjustment note; refund confirmation after actual payout; correction notice for reversed manual payment. Credit note uses original invoice/line GST and snapshots, not current product price. A reprint returns original bytes/hash. Regeneration uses the same snapshot/pinned renderer/template and may restore missing bytes only if SHA matches the recorded original; otherwise fail with DOCUMENT_RECOVERY_REQUIRED and preserve evidence for Admin recovery. New template versions apply only to newly issued documents. No alternate-rendition/history subsystem is needed in v1. Draft previews watermarked DRAFT and not delivered as tax invoices.

Add partial unique document indexes: payment_id WHERE type=receipt; credit_note_id WHERE type=credit_note; refund_id WHERE type=refund_confirmation; payment_id WHERE type=payment_correction. Together with invoice_revision_id/type uniqueness and source_key, they prevent a new template/key from duplicating an official receipt or number. Any receipt regeneration remains the same document row and number. Zero-total issued cancellation needs no positive credit row: mark cancelled with reason and cancellation audit/notice, preserving the zero invoice snapshot.

24/7 Truck Tyre Services identity, ABN, exact branch addresses/phone/email, logo, bank instructions/footer are required Admin configuration. Unknown values block issue, not replaced by placeholders. Private staff fields, costs, WAC, internal notes and provider IDs are absent from customer documents. PDF verification includes page breaks, long descriptions, totals, identity, 1,000+ buyer identification, adjustment references, legible print, selectable text and accessible HTML equivalent. Quote/PO/transfer documents remain deferred.

## 14. Application routes and responsive UX

All proposed staff pages live under `inventory-app/app/(protected)` and reuse AppShell/PageHeader and permission navigation. No public ecommerce. New finance integration settings stay together, not three new top-level settings products.

| Route | Guard and primary actions | Desktop / mobile / empty/loading/error |
|---|---|---|
| `/invoices` | invoices.view; create button additionally create | Desktop filterable table number/customer/branch/issue/due/total/credits/net paid/balance/badges; mobile stacked invoice cards and filter sheet. Empty: No invoices with permitted Create; skeleton; retryable safe load error. |
| `/invoices/new` | invoices.create + view | Manual service form or completed-job selector; desktop two-column form/summary, mobile sequential fields/sticky total. Empty job results explain none eligible; loading disables submit; validation/version errors retain input. |
| `/invoices/[id]` | invoices.view, branch | Header/business/customer/vehicle/source links, lines/tax/total, revision selector, payment/refund/credit timeline and delivery history according to sub-permissions. Desktop main document + action panel; mobile collapsible sections and labelled action menu. 404/denied uniformly for hidden ID; skeleton; safe retry on server failure. |
| `/invoices/[id]/edit` | invoices.edit + view | Draft editor or explicit unpaid revision flow with reason; never edits issued row in place. Desktop form/summary, mobile single column; stale conflict reload/review, cancelled/paid read-only explanation. |
| `/receivables` | receivables.view | Operational AR table/cards: invoice/customer/branch/due/original/credits/gross paid/net paid/balance/aging/last and next reminder/link status; filters All/LON/REG per access, aging, customer, due range. Empty: No outstanding invoices; skeleton; safe retry. Refund due shown in distinct tab, never netted against AR. |
| `/payment-reconciliation` | payments.reconcile (+payments.view for payment details) | Matched/Needs Review, evidence reasons and verified refresh/match actions. Desktop split evidence/detail, mobile detail drill-down; unknown branch Admin-only. Empty: Nothing needs review; loading; failure retains evidence and offers retry. |
| `/settings/finance` | hard Admin role | Tabs Business/Branches, Payments, Email/Reminders, document preview; only nonsecret config and health indicators. Desktop labelled sections; mobile vertical form. Empty requires configuration; loading; optimistic conflict with reload. |
| `/jobs`, `/jobs/[id]` | existing jobs guards; invoice actions separately | Invoice badge/link or Completed—Not invoiced; completion checkbox Create invoice. Mobile actions remain tap-sized; invoice failure is transactional and displayed without suggesting stock retry manually. |
| `/pos` | pos.use and action-specific guards | Shared sale form + tender stage; desktop cart/tender side by side, mobile sequential review→tender→confirmation. Empty cart prompt; pending submit locked; stable idempotency on retry; awaiting Stripe clearly not settled. |
| `/customers/[id]` | existing customer guard; AR/invoice/payment sections independently guarded | Branch-scoped finance panels; Admin All possible; manager label “This location” prevents suggesting global account total. Empty history; section loading/errors isolated. |

No standalone `/payments`, `/settings/email`, `/settings/payments` in v1: invoice detail contains payment entry/history and AR/reconciliation provide operational discovery. Invoice list filters location/status (lifecycle/payment/refund separately), due state/customer/date with server allowlists and bounded cursor paging. Two-dimensional pagination ordering includes id tie-breaker.

Detail actions: Edit draft/Revise unpaid, Issue, Record payment, Send invoice, Create/Revoke payment link, Credit/Refund, Retry email, Cancel. State/permission-aware UI hides unavailable actions, but server and RPC repeat all enforcement. Refund dialog clearly shows maximum, original tender, invoice credit effect, pending payout and “Does not return stock.” Reversal is labelled “Correct a recorded payment” and distinct from customer refund.

Accessibility: labelled money/date fields, keyboard reachable dialogs/actions, visible focus, live-region status, focus moves to error summary, no colour-only state, minimum 44px touch targets, responsive 320/375/390/768/1440 coverage, horizontal tables avoided on mobile. No raw database/provider exception shown. Optimistic conflict never discards staff input silently.

## 15. Application module boundaries

Proposed `lib/finance/{types,validation,queries,errors,money,dates,permissions}.ts`; `lib/finance/{stripe,email,documents,worker}.ts` server-only; `components/finance/*` for invoice form/list/detail, payment/refund dialogs, receivables, reconciliation and delivery history. Preserve existing `components/sales/sale-draft-form.tsx` search UX and shared job model; extend quote/job discount inputs under their existing guards.

Use `ActionResult<T>` for safe typed field/global/conflict results. POST actions validate shape with Zod, load active staff access, force manager branch, call authenticated Supabase RPC, map known finance sentinels, revalidate affected invoice/job/customer/AR paths. Never calculate/submit authoritative totals, payment state, actor or provider IDs from browser input. Decimal strings cross API boundaries; money formatting is display-only. Route handlers are Node runtime for Stripe/PDF where SDK requires it.

## 16. Server actions, RPC and API contracts

Staff mutation envelope: `(p_request_id uuid, p_expected_version integer where existing entity, target UUID, narrowly typed/allowlisted JSON input) → jsonb {entity_id,version,...safe IDs/state}`. Public read functions accept authorised filters and bounded cursor/limit and return explicitly safe fields. Function names below are final proposed names, not claims of existing implementation.

| Server action | Authenticated RPC | Enforcement/return |
|---|---|---|
| `createInvoiceFromJobAction` | `create_invoice_from_job` | completed proof; invoices.create, job view; draft ID/version |
| `completeJobAndCreateInvoiceAction` | `complete_job_and_create_invoice` | jobs.complete + invoices.create; same transaction |
| `finalisePosSaleAction` | `finalise_pos_sale` | POS/job/invoice/tender dependencies; all database effects atomic |
| `createManualInvoiceAction` | `create_manual_invoice` | service-only lines; invoices.create |
| `updateInvoiceDraftAction` | `update_invoice_draft` | version/state/discount cap; invoices.edit |
| `reviseUnpaidInvoiceAction` | `revise_unpaid_invoice` | no successful payment ever/hold; edit+issue; immutable revision |
| `issueInvoiceAction` | `issue_invoice` | invoices.issue; identity/pricing/terms/doc intent |
| `cancelInvoiceAction` | `cancel_invoice` | invoices.cancel; zero money liability/no pending; scoped adjustment |
| `recordPaymentAction` | `record_invoice_payment` | payments.record; single/atomic tender array; exact locked balance |
| `reversePaymentAction` | `reverse_manual_payment` | payments.reverse; immutable correction |
| `createRefundAction` | `create_invoice_credit_refund` | refunds.create; credit lines + one/many payout reservations |
| `confirmManualRefundAction` | `confirm_manual_refund` | refunds.create; actual payout evidence |
| `retryRefundAction` | `retry_invoice_refund` | refunds.create; reuse existing credit; only proven terminal failure permits new payout intent |
| `createPaymentLinkAction` | `prepare_stripe_checkout` | payments.record; reserve outstanding then server API |
| `revokePaymentLinkAction` | `request_checkout_expiry` | payments.record; sets expiring, provider confirmation required |
| `reconcilePaymentAction` | `request_finance_reconciliation` | payments.reconcile; typed request, server fetch; no arbitrary mark-paid |
| `sendInvoiceAction`, `sendReceiptAction`, `sendCreditDocumentAction` | `enqueue_finance_email` | documents.send + entity view; type/entity allowlist; outbox |
| `retryDeliveryAction` | `retry_finance_email` | documents.send; delivery certainty/window rules |
| `updateInvoiceDeliveryAction` | `update_invoice_delivery_preferences` | documents.send; version, audited recipient/suppression |
| `recordReceivableFollowupAction` | `record_receivable_followup` | receivables.view + documents.send; invoice branch/version, mandatory follow-up reason; append RECEIVABLE_FOLLOWUP_RECORDED audit, no ledger change |
| `updateFinanceSettingsAction` | `update_finance_settings` | hard Admin; version/nonsecret identity/flags only |

Read RPCs: `invoice_summary`, `invoice_detail`, `invoice_cost_detail`, `receivables_summary`, `customer_receivables`, `payment_reconciliation_summary`, `finance_document_access`, `finance_settings_detail`. Each uses active auth, relevant permission and branch. Full provider raw payload is never returned. All read functions also revoke PUBLIC/anon/service_role and grant authenticated.

Service-only RPCs: `ingest_stripe_event`, `process_stripe_event`, `finalise_stripe_checkout`, `finalise_checkout_expiry`, `finalise_stripe_refund`, `claim_finance_work`, `finalise_finance_document`, `finalise_finance_email`, `record_finance_attempt`, `prepare_unmatched_provider_refund`. Each enforces fixed object relationships, expected version/lease and service-only execution. Last function additionally consumes an Admin-authored reconciliation request stored by the staff path; possession of webhook input is not Admin approval.

Endpoints:

- `POST /api/payments/checkout`: staff session + CSRF/origin protection, payments.record, same createPaymentLink service; no unauthenticated session creation by invoice ID.
- `POST /api/stripe/webhook`: raw signed provider body, no staff-session requirement, bounded body/time, durable ingestion before 2xx.
- `GET /api/cron/finance`: cron secret, no staff-session requirement, bounded/fenced durable claims; no unauthenticated fallback.
- `GET /api/documents/[id]`: staff entity permission/branch, private no-store stream or short-lived URL; UUID not sufficient authority.
- `/payment/return`: generic public processing/cancel acknowledgement, no invoice details or state mutation.

Existing search routes need invoice-related read permissions added only for appropriate invoicing work; a manual invoice cannot obtain a product line by forging search result IDs. Job/POS pickers continue existing permissions and product/used-unit RPCs. No public invoice API is introduced.

## 17. Audit and operational evidence

Reuse `audit_events`. Event names follow uppercase existing sales convention: INVOICE_CREATED, INVOICE_DRAFT_UPDATED, INVOICE_ISSUED, INVOICE_REVISED, INVOICE_CANCELLED, DISCOUNT_APPLIED/CHANGED, PAYMENT_RECORDED, PAYMENT_REVERSED, STRIPE_PAYMENT_MATCHED, STRIPE_RECONCILIATION_REQUESTED/RESOLVED, CREDIT_NOTE_ISSUED, REFUND_REQUESTED/CONFIRMED/FAILED, DOCUMENT_RENDERED/FAILED, EMAIL_QUEUED/SENT/FAILED/REVIEW_REQUIRED, REMINDER_SENT/SUPPRESSED, FINANCE_SETTINGS_UPDATED.

Details: safe entity IDs/numbers, branch, expected/actual versions, before/after permitted amounts/settings, reason, request ID, provider event/object IDs where internal, automation actor_kind, template/delivery ID. Released `audit_events_actor_role_check` accepts only admin/manager. The foundation migration must extend that CHECK additively to admin/manager/system while retaining every existing row: Stripe/worker use actor_user_id NULL, actor_role system and details.actor_kind stripe/worker through a private helper called only from the service boundary. Staff events continue actual admin/manager identity. Never spoof an auth.users row or seed a fake system customer/user. Cost audit detail is restricted; public document/email never receives it. Audit write happens inside authoritative transaction; provider/worker audit uses safe service helper. UI audit timelines expose only authorised fields, not full details JSON.

## 18. Financial and inventory invariants

1. Unique branch document numbers; one invoice per source job; invoice revision contents immutable after issue.
2. No successful payment/credit/refund/reversal deletion; no negative/float-authoritative amounts; AUD exact cents.
3. Invoice payment/reconciliation state is derived from confirmed financial evidence. Pending/failed refunds do not pretend cash was paid.
4. Ordinary applied money cannot exceed payable amount; unexpected provider money is visible Needs Review, not lost or coerced.
5. Credit values/GST cannot exceed original remaining line values. Successful/pending/uncertain refund sums cannot exceed original payment or approved refund obligation.
6. Manual reversal is not a refund; original payment and receipt remain immutable; first-payment financial lock persists.
7. An external provider success may need review but may never be silently discarded. Browser redirect never proves payment.
8. Email/PDF/cron failure cannot invalidate issued financial history. Durable dedupe survives restart.
9. No finance-only RPC posts inventory movements, changes balances, reservations or used units. Only the composed job completion path calls the released stock owner once.
10. Invoicing an already completed job creates zero stock movements; refunds/credits/reversals create zero stock movements.
11. Preserve opening import/movement evidence and duplicate-free constraints. Do not reseed historical customers/jobs or opening stock.
12. Positive on-hand with NULL WAC and NULL captured cost remains unknown; no later WAC revaluation or zero substitution for invoice history.

## 19. Dedicated threat review

| Threat | Mitigation and required negative test |
|---|---|
| IDOR/BOLA/invoice enumeration | Auth + entity/branch guard in page/action/read+write RPC/document route; uniform hidden-ID response; random UUID is not authorisation. Foreign customer/global identity does not grant another branch finance. |
| Manager cross-location | Force manager location from active profile, reject supplied mismatch in SQL, parent-child composite checks; test every finance/read/export-equivalent document route using other branch IDs. |
| PUBLIC/anon grants | Explicit per-function revoke after creation, SQL ACL inspection tests and anon invocation; table RLS enabled with direct mutation denied. |
| SECURITY DEFINER/search_path | Empty search_path, qualified identifiers, no dynamic SQL, controlled owner, helpers unexposed, actor derived internally. Test malicious shadow names where feasible. |
| Service/provider secret exposure | server-only modules, no NEXT_PUBLIC secrets, no secret values in settings/API/build output/logs; production bundle scan and authenticated/anon endpoint tests. |
| Webhook spoof/replay/order | Raw-body signature/tolerance, expected account/mode, durable event/payment/refund uniqueness, provider current-state reconciliation; duplicate/out-of-order/unknown event tests. |
| Link guessing/PII | Stripe-hosted opaque URL, no public invoice-ID lookup, fixed redirect destinations, no URLs in analytics/logs, explicit expiry/revocation holds. |
| Customer PII/cost leakage | Explicit RPC/document projections and private storage; no internal notes/cost in email/PDF/list payload; branch-specific customer balances; snapshot access tests. |
| Audit alteration | No UPDATE/DELETE grants, immutable issued/financial records and append events; forged actor denied. |
| Mass assignment/forged totals | Narrow schemas, reject extra keys, exact DB recomputation and discount caps; browser price/state/actor/provider IDs ignored/rejected. |
| Overpayment/refund races | Invoice-first locks, active checkout hold, in-flight refund reservations, unique provider IDs; parallel transaction tests. |
| Open redirect/SSRF | Fixed app return URLs and Stripe URL origin validation; only approved local logo/fonts/private objects for PDF; no user URL fetch. |
| CSRF | Next server-action protections plus session/origin checks on staff POST API; webhook deliberately authenticated by signature, cron by secret. GET document read has no business mutation. |
| Cron spoof/races | Missing secret fails closed; SKIP LOCKED leases with fencing; invoice-stage and email key uniqueness; double cron and crash tests. |
| Email duplication/abuse | Durable attempts, idempotency window awareness, recipient validation, rate/batch limits, no arbitrary recipient relay; documents.send and same entity only. |
| Refund misuse | Permission/reason/cap/original tender, pending reservation, no automatic stock return; manual confirmation distinct from approval. |

## 20. Test matrix and evidence gates

Tests below are required future work; they were not executed in this documentation session. Add focused regression fixtures to disposable local Supabase only.

| Layer | Cases and assertions |
|---|---|
| Unit money | 110→100 ex/10 GST; half-cent base/discount boundaries; 0/100% discounts; multi-line GST largest-remainder ties; 0.01 and many-line sums; fractional labour; product whole quantity; reject >2dp payment/price and >3dp qty; overflow; repeated credits exhaust exact original GST; NULL price blocked and NULL cost preserved. |
| Unit dates | Adelaide midnight vs UTC, DST transitions, issue-day receipt/7/14/30 calendar days, retained original issue date on revision; overdue day 0/1/7/8/14/15/29/30; leap/year boundary. |
| Unit finance | Full/partial/split payment, reversal, partial/full/failed/late-failed refunds; T/C/G/A/R examples; no cross-invoice netting; active hold availability; customer visible-branch aggregate. |
| Unit auth/UI | Admin override, manager grant+cap, missing view dependencies, branch constraints, safe errors, no cost in standard payload; stale input retained; reminder suppression/recipient selection/late-stage catch-up; no-email/invalid email. |
| DB invoice | Completed product/used/labour job→draft; movement proof mismatch denial; no second consumption; issue/revision immutable; first-payment lock after reversal; pending price; invoice numbering concurrency; duplicate job invoice; identical/different-payload replay. |
| DB atomicity | Inject failure after completion before invoice, after invoice before tender, and before audit; entire POS/wrapper rollback including child requests and movement count. Retry same outer key succeeds once. Concurrent old completion vs wrapper does not double consume. |
| DB payments | Two staff pay same balance; split sum overflow; duplicate tender intent; exact full/partial; bank repeated ref warning; reversal once; stale expected_version; checkout hold vs manual payment. |
| DB refunds | Two competing refunds; payment and credit cumulative caps; partially paid full/partial sale cancellation; pending→success/failure; timeout still reserved; retry credit reuse; external unmatched return Admin-only; no inventory change. |
| Stripe integration | Signed test fixtures, invalid/raw-body altered signature, wrong mode/account/currency/amount/revision, unknown invoice; same event replay and distinct events one PI; out-of-order success/failure; session complete unpaid; event before finalise row; API timeout with eventual success; delayed expiry/payment race; refund success then verified failure; dispute Needs Review; unmatched return cannot affect AR. |
| Email/worker | Business commit survives send/render failure; same key same payload, payload mismatch; lease expiry/fencing; timeout inside vs beyond 24h; provider acceptance but finaliser crash; no automatic duplicate; missing/invalid recipient; changed override; independent invoice failures. |
| Reminders | Four exact stage dates; due-on-receipt pre-stage skipped; missed runs latest only; duplicate cron; stage unique across revision; paid/cancelled before claim/send; in-flight race documented; reversal does not resend old stage; no-email, suppression, retry and 14-day nonrecurrence. |
| RLS/security | All staff RPCs as Admin/enabled manager/disabled manager/other branch/anon/service role; all privileged function ACLs; direct table DML denied; private helper execute denied; cost and PII projection tests; immutable history/audit. |
| E2E | Job→invoice, optional atomic completion, POS split/on-account/online pending, manual service invoice, issue/revise, payment/reversal, AR aging, refund/credit, send/retry, link revoke; 320–1440 mobile/tablet/desktop keyboard/accessibility, no browser errors or secret payloads. |
| Documents | Historical customer/settings/product change leaves bytes/snapshot stable; invoice/revision/receipt/credit/refund totals and GST; long multipage lines; logo identity; no private fields; buyer identity guard; PDF SHA and protected download. |
| Database install | Clean all-migration install; upgrade from exact Phase 3B history; catalog equivalence; DB lint/advisors; FK/check/index/idempotency ACL inventory; no opening evidence changes. |
| Regression | All Phase 1–3B unit/integration/E2E suites, including opening-stock import/replay/dataset, pending valuations, purchasing, transfers, customers, quotes/jobs/POS and search security. No production test target or fake live finance. |

## 21. Implementation and migration structure

The companion plan gives ordered, reviewable tasks, acceptance and stop conditions. Slices: 4A schema/money/revisions/discount foundation; 4B invoice UI + composed job completion; 4C manual payments/reversals/AR + POS finaliser; 4D credits/refunds + issued cancellation; 4E Stripe; 4F documents/Resend; 4G reminders; 4H hardening/rollout. POS manual tender cannot be activated until 4C; online path waits for 4E. Foundation includes the financial_documents intent table so issue/payment can enqueue work; PDF rendering/storage follows in 4F. Add optional payment/credit/refund document FKs only when those parents exist in C/D, Stripe FKs in E and reminder/email pairing in G. Early read/RPC versions must reference only then-existing tables; expand guards/projections in each dependent additive migration, retaining the no-finance first_payment lock in B. No placeholders that fail at runtime are acceptable. Public launch waits for all required documents/providers and identity configuration.

Future additive migrations are timestamped at implementation time, strictly after the released migration frontier. Never edit Phase 1–3B files. Preserve the baseline's `20260905003608_phase_3b_sales_picker_search.sql` ordering despite its early timestamp; do not rename/repair it. Separate foundation tables, invoice RPCs, commercial discount extensions, payments/AR, credits/refunds, Stripe inbox/checkouts, documents/outbox, reminders, and final restricted grants/index hardening into small reviewed migrations. No SQL credentials, production seeds, mass invoice backfill or rewritten opening evidence. Clean install and exact-baseline upgrade both gate every dependent release.

## 22. CI, production rollout and incident constraints

CI extends `.github/workflows/inventory.yml`: Node22/npm lockfile, lint/typecheck/unit/build, disposable Supabase clean migration install + exact Phase3B upgrade, all integration/E2E, DB lint/advisors/security ACL invariants, provider mocks/signed webhook fixtures/test-mode acceptance, replay/concurrency and financial/inventory invariants. Pin CLI/SDK versions during implementation instead of making future correctness depend on latest. Existing CLI reset in CI is only disposable local infrastructure and is not permission to reset any database now.

Production gates are detailed in the plan: (1) approved exact release SHA/merge/CI; (2) provider test-mode and sender/secret/auth verification; (3) exact project/history/opening and current-ledger preflight; (4) reviewed exact migration dry run; (5) additive apply only; (6) migration/ACL/invariant postflight; (7) exact Vercel project/SHA/READY/custom-domain alias proof; (8) authenticated read-only smoke; (9) separately authorised controlled provider acceptance; (10) separately authorised live Stripe/email/reminder activation. Do not infer release from READY alone or create fake live records.

Before real finance, application rollback may restore prior verified deployment and retain additive schema. After finance exists, preserve history and provider intake: disable new checkout/reminders/email as needed, retain webhook receipt if safe, reconcile provider truth and forward-fix/compensate. Never destructive down-migrate, delete events/payments/refunds, or casually restore database. If rolling back app to Phase3B would remove webhook intake or hide obligations, first maintain a compatible finance intake/operations route or use a finance-compatible forward fix. Verify custom-domain alias after any rollback. Database rollback and application alias change are separate actions.

## 23. Failure and recovery contract

The plan contains the complete per-failure matrix. Governing rules: a failed DB transaction has no partial financial truth; a provider API timeout has unknown external truth; a durable inbox/outbox carries recovery across deploys; only verified provider facts settle provider cash. A completed job produced by old standalone completion is valid and can be invoiced later, whereas a failure of the new atomic wrapper must leave neither completion nor invoice committed. Staff must never be instructed to replay consumption as an invoice recovery technique.

Manual reconciliation must retain evidence, reason and actor. It cannot forcibly mark a mismatched event matched, edit a provider amount, delete a duplicate payment or silently forgive debt. Reversal/credit/refund are distinct compensating operations with exact ledger effects.

## 24. External technical references checked during planning

These references constrain adapter design; pin SDK/API versions and verify details again when implementation starts:

- [Stripe webhook documentation](https://docs.stripe.com/webhooks?lang=node): signature verification, duplicate events and non-guaranteed delivery ordering motivate durable inbox/object uniqueness/current-state reconciliation.
- [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create): server-created hosted session, metadata and expiry configuration.
- [Stripe refunds](https://docs.stripe.com/refunds): partial refunds, original-payment limits, pending/failed outcomes and original-method return constrain the payout state machine.
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys): 24-hour deduplication window requires explicit uncertain-delivery recovery beyond that window.
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs): scheduler authentication and concurrency must be handled explicitly.
- [ATO tax invoice requirements, GSTR 2013/1](https://www.ato.gov.au/law/view/document?LocID=%22GST%2FGSTR20131%2FNAT%2FATO%2Ffp81%22&PiT=20231128000001) and [adjustment notes, GSTR 2013/2](https://www.ato.gov.au/law/view/document?LocID=%22GST%2FGSTR20132%2FNAT%2FATO%2Ffp4%22&PiT=20251205000001): support actual supplier/buyer identification and scoped adjustment-document fields. These documents inform output requirements, not BAS/accounting scope.

## 25. User decisions required and implementation readiness

Technical A–L questions are resolved in sections 4–12. No unresolved table, transaction, allocation, rounding, state or security choice is delegated to the next implementer.

**USER DECISION REQUIRED — configuration before issue/activation, not permission to implement now:**

1. Confirm actual legal/business identity, ABN, approved logo, shared sender/reply address, both branch address/phone/contact blocks, bank/payment instructions and footer. Do not guess from marketing defaults.
2. Choose which managers receive new finance permissions and each manager's discount cap. Safe initial state: no new manager grants and no positive manager discount until explicitly configured; Admin mathematical cap is 100% with mandatory reason. Explicitly acknowledge that refunds.create permits that manager to both approve and confirm up to a full eligible refund within their branch; no second-approver policy is implied.
3. Approve actual Stripe account/live activation, verified Resend sender and automatic email/reminder activation after test-mode and rollout gates. All automation defaults off; no live setup is authorised by this plan.

No multi-invoice allocation, overpayment wallet, labour catalogue or Phase 5 decision is pending: they are excluded. Shared-sender policy, schedule, timezone, due terms and aging boundaries are fixed above. The final implementation is not started until separately requested.

## 26. Planning verification

Executed in this session: repository fetch, exact remote SHA, status/branch/remotes/worktrees/recent history, read-only source/schema/provider inventory, documentation review and final whitespace/status verification. Node observed `v22.23.1`, npm `10.9.8`; no install/build/lint/test/provider call against production was necessary for Markdown-only work. Tests in section 20 are a future matrix, not claimed pass evidence.

Final documentation verification commands:

```powershell
Set-Location -LiteralPath 'C:\Users\abuba\.worktrees\247truck-phase-4-plan'
git rev-parse HEAD
git diff --check
git status --short
```

Expected HEAD remains the exact Phase 3B SHA and only the two new Phase 4 Markdown files are untracked. No migration/application files are created or modified.
