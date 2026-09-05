# Inventory Phase 4: Invoicing, Payments and Receivables Implementation Plan

## 1. Authority, baseline and boundaries

This plan implements the authoritative Phase 4 design in `docs/superpowers/specs/2026-09-06-inventory-phase-4-invoicing-payments-receivables-design.md`. If this plan and that design disagree, update this plan to match the design before implementation.

The code baseline is commit `2cb8a366ae76b47160044a9972bb78822e3ce21c` on the planning branch. Phase 4 must build on the existing inventory application in `inventory-app/`, including:

- access context and permissions in `lib/auth/types.ts`, `lib/auth/permission-keys.ts`, `lib/auth/permissions.ts`, and `lib/auth/access.ts`;
- protected navigation in `components/shell/nav.ts` and `app/(protected)/layout.tsx`;
- safe RPC error patterns in `lib/inventory/errors.ts` and `lib/purchasing/errors.ts`;
- optimistic version checks and idempotent action requests in `app/(protected)/quotes/actions.ts`, `app/(protected)/jobs/actions.ts`, and `supabase/migrations/20260905120000_phase_3b_quotes_jobs_pos.sql`;
- search and form patterns in `components/sales/sale-draft-form.tsx`, `lib/sales/queries.ts`, and `app/api/sales/*/route.ts`;
- disposable local Supabase validation in `.github/workflows/inventory.yml`.

All database changes are additive. Never reset a production database. The migration names below use symbolic timestamps because implementation must choose timestamps later than every migration present on its actual integration baseline. Preserve the existing unusually ordered pre-3B migration `20260905003608_phase_3b_sales_picker_search.sql`; do not rename, squash, or reorder existing migrations.

Phase 4 does not implement transferable customer credit, account-credit wallets, arbitrary payment allocation, accounting-ledger export, raw-card collection, automatic matching of unexpected Stripe payments, or deletion of financial history. Each applied payment belongs to exactly one invoice. Credits adjust one invoice. Ordinary refunds reference one payment; only the Admin-approved unmatched-provider return path has no invoice/payment/credit. Corrections are append-only.

The complete Phase 4 table inventory is exactly 18 tables: `finance_settings`, `finance_location_settings`, `invoices`, `invoice_revisions`, `invoice_lines`, `invoice_line_costs`, `finance_action_requests`, `payments`, `payment_reversals`, `credit_notes`, `credit_note_lines`, `refunds`, `stripe_checkouts`, `provider_events`, `financial_documents`, `email_deliveries`, `email_delivery_attempts`, and `reminder_deliveries`. There is no allocation, customer-credit, receivables-cache, receipt or new audit table. Receipts are `financial_documents`; receivables are derived read projections; audit reuses `audit_events`.

## 2. Invariants shared by every slice

1. A job has at most one invoice. Job/POS invoices belong to exactly one job; manual service invoices have no job. Every invoice belongs to one location.
2. Invoice lifecycle is `draft -> issued -> cancelled`. Cancellation is controlled and audited; it never deletes the invoice or its history.
3. Invoice content is represented by `invoice_revisions` and `invoice_lines` belonging to one revision. A draft revision may be edited through its parent version; an issued revision and its lines are immutable. The invoice points to its current revision.
4. An issued and unpaid invoice may receive a new issued revision through `revise_unpaid_invoice`. Revision is forbidden forever after `first_payment_at` is set, even if a manual payment is later reversed. Older revisions and documents remain immutable and addressable.
5. Cost snapshots live in a separate restricted `invoice_line_costs` table. Unknown cost remains `NULL`; it must never become zero by fallback or coercion.
6. Every successful payment belongs to one invoice. Successful payments may not make the invoice overpaid. Manual corrections append a full `payment_reversals` record; they never edit or delete the original payment.
7. `credit_notes` and `credit_note_lines` are scoped adjustments against one invoice. Approval creates the credit; only its authorised cash-return portion increases `A` and the distinct `refund_due` liability before payout. A debt-only credit has authorised_refund_amount zero. Ordinary refunds are scoped against one successful payment; exceptional return of wholly unmatched provider money is linked to provider evidence and requires Admin approval. Neither path creates transferable customer credit.
8. Money mutations execute inside database RPC transactions with row locks, expected versions where applicable, server-derived totals, permission and location checks, idempotency, and audit records.
9. Provider calls use durable records created before the external request. Webhooks and retries are idempotent. External identifiers are unique.
10. Customer-visible totals and internal cost data remain separated by RLS, grants, queries, types, and UI. All 18 Phase 4 tables have RLS enabled and direct privileges revoked from PUBLIC, anon, authenticated and service_role; access is only through explicitly granted staff or service RPCs. Do not change global default privileges.

The authoritative cents algebra is: `T` current issued revision total; `C` issued credit total; `G` succeeded payments excluding fully reversed manual payments; `A` sum of immutable `credit_notes.authorised_refund_amount`; `R` effective succeeded ordinary invoice payouts; `E = T - C`; `applied_to_sale = G - A`; `balance = E - applied_to_sale`; `refund_due = A - R`; and `actual_net_cash = G - R` (abbreviated `N`). Enforce `0 <= R <= A <= G`, `0 <= A <= C <= T`, and `0 <= applied_to_sale <= E`. Do not use max-clamping to hide invalid states. Display original total, credits, gross paid, reversed, refunded, actual net cash, applied-to-sale, balance and refund due separately.

Global lock order for every slice: outer finance request advisory lock → all required deterministic child sales-request advisory locks in sorted order → source job where relevant → invoices in deterministic UUID order → checkout/payment rows in deterministic UUID order → credit/refund rows → document/outbox rows. Provider-only unmatched returns acquire account/mode/PaymentIntent advisory lock then provider evidence/refund rows, with no invoice dependency. Never acquire that provider lock after an invoice lock or pre-lock inventory balances/reservations before released complete_job. Test standalone completion racing the wrapper using the derived child key.

Exact GST/date contract: AUD only; prices/payments/refunds max 2 decimal places, quantities max 3, cost numeric(14,4), discount numeric(5,2). DB NUMERIC computes base = round(quantity * unit_price_incl_gst, 2), discount = round(base * discount_percent / 100, 2), inclusive = base - discount, raw GST = inclusive / 11, invoice_gst = round(sum(inclusive) / 11, 2), and header ex-GST = sum(inclusive) - invoice_gst. Deterministic largest-remainder allocation (position/id tie-break) makes line GST sum to the header. All v1 lines use standard 10% GST; no tax engine, fixed/invoice-wide/stacked discount or independent price override. NULL price stays pending and blocks issue; NULL cost stays unknown. Business date is (now() at time zone 'Australia/Adelaide')::date; Individuals/Walk-In use due_on_receipt only, businesses may choose due_on_receipt/7_days/14_days/30_days, never an arbitrary due date. Aging is Current, 1–7, 8–14, 15–29, 30+.

Each slice references only tables available at its migration frontier; later slices add guards, FKs and projections before activating their workflows. Refund/credit/reversal RPCs never add stock, reverse movements, change used-unit status or recalculate WAC. Invoice edits never rewrite source jobs or consumed product identity/quantity. All provider/live automation flags remain OFF until explicit rollout approval.

## 3. Additive migration sequence

Implementation should create these migrations in order, substituting real monotonically increasing timestamps only after rebasing on the integration baseline:

1. `<TIMESTAMP>_phase_4a_finance_foundation.sql`
2. `<TIMESTAMP>_phase_4a_invoice_revisions_settings_discounts.sql`
3. `<TIMESTAMP>_phase_4b_invoice_job_pos_workflow.sql`
4. `<TIMESTAMP>_phase_4c_manual_payments_receivables.sql`
5. `<TIMESTAMP>_phase_4d_credit_notes_refunds.sql`
6. `<TIMESTAMP>_phase_4e_stripe_payments.sql`
7. `<TIMESTAMP>_phase_4f_financial_documents_email.sql`
8. `<TIMESTAMP>_phase_4g_receivable_reminders.sql`
9. `<TIMESTAMP>_phase_4h_finance_hardening.sql`

Do not create placeholder migrations during planning. Each implementation slice starts with failing tests, adds only its own migration and application files, runs its focused gates, and stops if its dependency or acceptance gate fails.

Every staff mutation uses a stable client-generated request UUID, expected version for an existing entity, narrowly allowlisted input and `ActionResult<T>`. Exact staff contracts are: `createInvoiceFromJobAction`/`create_invoice_from_job`, `completeJobAndCreateInvoiceAction`/`complete_job_and_create_invoice`, `finalisePosSaleAction`/`finalise_pos_sale`, `createManualInvoiceAction`/`create_manual_invoice`, `updateInvoiceDraftAction`/`update_invoice_draft`, `reviseUnpaidInvoiceAction`/`revise_unpaid_invoice`, `issueInvoiceAction`/`issue_invoice`, `cancelInvoiceAction`/`cancel_invoice`, `recordPaymentAction`/`record_invoice_payment`, `reversePaymentAction`/`reverse_manual_payment`, `createRefundAction`/`create_invoice_credit_refund`, `confirmManualRefundAction`/`confirm_manual_refund`, `retryRefundAction`/`retry_invoice_refund`, `createPaymentLinkAction`/`prepare_stripe_checkout`, `revokePaymentLinkAction`/`request_checkout_expiry`, `reconcilePaymentAction`/`request_finance_reconciliation`, document send actions/`enqueue_finance_email`, `retryDeliveryAction`/`retry_finance_email`, `updateInvoiceDeliveryAction`/`update_invoice_delivery_preferences`, `recordReceivableFollowupAction`/`record_receivable_followup`, and `updateFinanceSettingsAction`/`update_finance_settings`.

Exact read RPCs are `invoice_summary`, `invoice_detail`, `invoice_cost_detail`, `receivables_summary`, `customer_receivables`, `payment_reconciliation_summary`, `finance_document_access`, and `finance_settings_detail`. Exact service-only RPCs are `ingest_stripe_event`, `process_stripe_event`, `finalise_stripe_checkout`, `finalise_checkout_expiry`, `finalise_stripe_refund`, `claim_finance_work`, `finalise_finance_document`, `finalise_finance_email`, `record_finance_attempt`, and `prepare_unmatched_provider_refund`. Staff functions revoke PUBLIC/anon/service_role and grant authenticated; service functions revoke PUBLIC/anon/authenticated and grant service_role; private helpers grant neither exposed role family. All SECURITY DEFINER functions use an empty search path and qualified names.

## 4. Slice 4A — finance foundation, revisions, settings and discounts

### Objective

Establish the permission, configuration and immutable invoice data model, including revision rules and controlled discounts, without exposing invoice creation in the UI.

Migration boundary: future migrations 1 and 2 in section 3, in that order. Migration 1 owns finance tables, requests, document intent and audit-role extension; migration 2 owns revision/settings/discount primitives and additive quote/job/profile fields. No payment/provider tables or runtime references to them in 4A.

### Schema and RPC work

- Add `finance_settings` for global Admin-controlled defaults and numbering/configuration policy.
- Add `finance_location_settings` for branch document identity/contact/footer fields as specified by the design; bank/payment instructions remain in global finance_settings. Global and location rows must be versioned and audited.
- Add `invoices` with nullable unique `job_id`, location/customer identity, lifecycle state, current revision pointer, issue/cancel metadata and optimistic `version`. Do not cache paid, balance, refund or receivables aggregates; read RPCs derive them from finance rows in one SQL snapshot.
- Add `invoice_revisions` with invoice-scoped monotonically increasing revision numbers, source references, immutable snapshots, terms/dates, reason and financial totals. Draft rows are parent-version controlled; issue freezes them with a trigger. An unpaid revision creates a new issued row rather than editing the earlier issue.
- Add `invoice_lines` belonging to one revision, with product/labour source, description, quantity, fixed 10% GST, price, per-line percentage discount provenance and computed totals. The database derives totals; clients do not submit authoritative totals.
- Add restricted `invoice_line_costs` keyed to invoice line, with nullable cost snapshot and cost provenance. Grant access only through cost-authorized RPCs/policies.
- Add `finance_action_requests` with operation kind, actor, scoped idempotency key, request fingerprint, result reference and timestamps. Reuse with a different payload must raise `IDEMPOTENCY_KEY_REUSED`.
- Add the `financial_documents` intent/envelope table in foundation so issue/payment transactions in later slices can enqueue immutable document work atomically. Rendering, storage and customer delivery remain inactive until 4F.
- Add audit event types and indexes for invoice/revision/settings actions. Additively extend `audit_events_actor_role_check` in foundation from `admin,manager` to `admin,manager,system`, preserving every row. Service-boundary helpers use actor_user_id NULL, actor_role system and safe details.actor_kind stripe/worker; never fake a user/customer.
- Implement read RPCs for invoice summary/detail/revision history and Admin settings.
- Reuse `private.next_location_document_number(uuid,text,text)` for `INV`, later `RCT`, and `CRN`; do not widen `next_sales_number`.
- Implement Admin-only `finance_settings_detail` and `update_finance_settings` using expected versions.
- Implement draft/revision RPC primitives with row locks, expected invoice version, discount permission enforcement and server-side algebra. Enforce the rule that revision is impossible after any successful payment.
- Add `finance_discount_limit_percent numeric(5,2) null` to existing `user_profiles`, configured through the Admin user-management path. `NULL`/zero blocks a Manager's positive discount; it is a cap, not a grant. Extend existing `quote_lines` and `job_lines` additively with `discount_percent`, reason/actor/authorised timestamp and `internal_note`; do not recalculate old rows. Discounts are per-line percentage only, positive changes require `discounts.apply`, a reason and relevant edit/create permission. Only an unchanged exact database source line may carry existing provenance quote→job→invoice without current discount authority; any product, quantity, base price, identity or discount change must pass the current permission and cap and must not apply the discount twice.

### Application work

- Add all permission keys to `lib/auth/types.ts`, `MANAGER_GRANTABLE_PERMISSIONS` and labels in `lib/auth/permission-keys.ts`: `invoices.view`, `invoices.create`, `invoices.edit`, `invoices.issue`, `invoices.cancel`, `payments.view`, `payments.record`, `payments.reverse`, `payments.reconcile`, `refunds.create`, `receivables.view`, `discounts.apply`, and `documents.send`.
- Keep finance settings, business identity, bank/payment integration settings, Stripe/Resend configuration and secrets hard Admin-only; do not introduce grantable settings/integration permissions. Seed no Manager finance grants. Admin permission UI must explicitly explain that refunds.create allows the same Manager to approve and confirm an eligible branch refund within DB limits, without a second approver. Manager caps default NULL/zero; Admin maximum is 100% with reason.
- Add finance domain types, validation, queries, errors, money, dates and permission helpers under `lib/finance/`. Use decimal strings at boundaries, exact NUMERIC in SQL, deterministic largest-remainder line GST allocation, Australia/Adelaide dates, and aging buckets Current, 1–7, 8–14, 15–29, 30+.
- Add `/settings/finance` and exact `updateFinanceSettingsAction`, guarded hard Admin in page and action; it stores nonsecret identity/flags only. Extend the existing Admin user-management action for manager caps.

### Tests and acceptance

- Unit-test permission inventory, labels, discount validation, nullable cost representation, money input validation and safe error mapping.
- Integration-test one-invoice-per-job, issued immutability, sequential revision numbers under concurrency, permanent `first_payment_at` revision lock, Admin settings, manager location/cap rules, additive quote/job discount provenance, unknown cost as `NULL`, general-numbering concurrency, idempotency replay and mismatched replay rejection.
- Acceptance: a database-only test can create an invoice draft and multiple unpaid revisions while proving old revisions unchanged; it cannot revise after a controlled first_payment_at lock fixture (actual payment/reversal tests start in 4C), read costs without permission, or bypass Admin settings controls.
- Dependency: Phase 3B jobs/POS migration and access model.
- Stop if the authoritative money algebra is unresolved, any invariant requires destructive migration, existing Phase 3B tests regress, or cost data can cross the permission boundary.

## 5. Slice 4B — invoice UI, atomic job invoicing and POS

Migration boundary: future migration 3 in section 3 only.

Permissions: invoices.view/create/edit/issue/cancel plus relevant jobs.view/complete; pos.use for existing POS source UI. Draft cancellation only.

### Objective

Expose branch-scoped invoice creation, revision, issue and cancellation, and connect jobs/POS to invoices through atomic workflows.

### RPC, actions and routes

- Implement `create_invoice_from_job`: explicit action for an already completed job, creates one draft after verifying exact consumption proof and never posts/repairs stock or performs historical backfill.
- Implement `complete_job_and_create_invoice`: derive and acquire every child commercial-request advisory lock in deterministic order before locking the job, then call released `public.complete_job` once inside the same transaction and create a draft. Any failure rolls back job completion, stock effects, numbering and invoice. Do not acquire finance/inventory locks in an order that reverses the released completion graph.
- Prepare POS UI/composition for later tender settlement, but do not activate `finalise_pos_sale` in 4B: its manual-tender transaction belongs to 4C and its Stripe continuation belongs to 4E. Early 4B tests cannot reference later payment/provider schema.
- Implement `create_manual_invoice` for labour/service/other-charge descriptions represented only as labour lines, never product or used-unit IDs.
- Implement `update_invoice_draft`, `revise_unpaid_invoice`, and `issue_invoice`. Implement draft-only `cancel_invoice` support here; issued cancellation is activated in 4D only after credit/refund tables exist. Issue is explicit outside POS.
- Add `lib/finance/queries.ts` list/detail/revision queries with manager location scoping.
- Add exact server actions in `app/(protected)/invoices/actions.ts`: `createInvoiceFromJobAction`, `completeJobAndCreateInvoiceAction`, `createManualInvoiceAction`, `updateInvoiceDraftAction`, `reviseUnpaidInvoiceAction`, `issueInvoiceAction`, and `cancelInvoiceAction`.
- Add `/invoices`, `/invoices/new`, `/invoices/[id]`, and `/invoices/[id]/edit`. New supports manual service invoices and eligible completed jobs. Detail contains revision selection, documents and subpermission-filtered finance history/actions.
- Update `app/(protected)/jobs/[id]/page.tsx`, job actions and POS flow to show the linked invoice and prevent duplicate creation. Keep the unique database constraint authoritative.
- Add `Invoices` navigation through `components/shell/nav.ts`, permission-filtered for desktop and mobile More navigation.

### Tests and acceptance

- Unit-test navigation, form policies, revision eligibility, issue/cancel controls, permission-hidden actions and safe version-conflict messages.
- Integration-test atomic job/invoice behavior, concurrent invoice creation for one job, exact snapshot data, branch isolation, issue/cancel transitions, and revision eligibility with unset/set first_payment_at fixtures; actual payment/reversal integration starts in 4C.
- E2E-test Admin and Manager invoice list/detail/create/issue/revise/cancel flows, job-to-invoice link, POS-created job invoice behavior, mobile routes and denied actions.
- Acceptance: explicit completed-job invoicing creates a draft with zero inventory movements; selected completion creates a draft atomically; repeated/concurrent requests never create a second invoice; stale forms return safe `INVOICE_VERSION_CONFLICT` without losing input. No 4B acceptance depends on payment, credit, refund or Stripe tables.
- Dependency: 4A.
- Stop if job completion can partially commit, invoice numbering can duplicate, a Manager can cross locations, or a stale client can overwrite a newer revision.

## 6. Slice 4C — manual payments, reversals and accounts receivable

Migration boundary: future migration 4 in section 3 only.

Permissions: payments.view/record/reverse, receivables.view and invoices.view; POS additionally pos.use, jobs.create/edit/complete and invoices.create/issue. No implicit grants.

### Objective

Record invoice-specific cash, EFTPOS and bank payments, provide append-only reversal correction, and expose reliable receivable balances and aging.

### Schema, RPC, actions and routes

- Add the manual-payment form of `payments` with invoice/revision, location/customer, method, amount, effective date, reference/notes, status, creator, request and timestamps. Do not add Stripe/provider foreign keys until 4E creates their parent tables.
- Add append-only `payment_reversals` referencing the original payment, with the full reversed amount, reason, actor and timestamp. Phase 4 manual correction reverses the full payment; partial correction requires a reversal followed by a new correct payment.
- Extend foundation `financial_documents` with payment/correction source foreign keys only after `payments` and `payment_reversals` exist; early 4A/4B functions must not reference them.
- Add unique keys for external/provider references where present and action-request idempotency.
- Implement `record_invoice_payment` with invoice row lock, expected version, issued/priced state, exact-cents positive single or split-tender array, sequential remaining-balance checks, location/access enforcement, first-payment lock and receipt intents.
- Implement `reverse_manual_payment` with invoice then payment locks, eligible source/status checks, exactly-once full reversal and audit. Disallow Stripe reversal and disallow reversal when any refund history or any credit payout obligation exists against that payment, regardless of current refund status. Recompute projections with the authoritative algebra. In 4C only payments/reversals exist; add refund-history/credit-obligation guards in 4D and checkout/Stripe guards in 4E before enabling those paths. Never reference future tables in earlier RPCs.
- Activate `finalise_pos_sale` and `finalisePosSaleAction` for manual split tenders and business on-account flow in this slice, using one database transaction. Individual/walk-in manual POS requires full settlement; zero total requires no payment. Stripe POS remains inactive until 4E.
- Add exact read RPCs `invoice_summary`, `invoice_detail`, `invoice_cost_detail`, `receivables_summary`, and `customer_receivables` with branch-safe projections, as-of dates and bounded cursor search.
- Add exact actions `recordPaymentAction` and `reversePaymentAction` under the invoice action module and invoice-detail dialogs/history; add `/receivables`.
- Add `Receivables` navigation gated by `receivables.view`; use `payments.view/record/reverse/reconcile` separately.

### Tests and acceptance

- Unit-test manual payment validation, method/reference policy, aging bucket boundaries and reversal UI policy.
- Integration-test exact/full/partial payments, concurrent overpayment attempts, duplicate request replay, reversal replay, balance restoration, cross-location denial, and post-payment revision lock.
- E2E-test record payment, paid/part-paid display, reversal with reason, AR search/filter/aging, permission-denied and mobile flows.
- Acceptance: concurrent transactions cannot overpay; a reversal preserves the original payment and adds one immutable correction; AR totals reconcile to invoice detail under the authoritative algebra.
- Dependency: 4B.
- Stop if a payment can float between invoices, a correction edits history, aging totals disagree with invoice balances, or any overpayment race is reproducible.

## 7. Slice 4D — scoped credit notes, refund liabilities and payouts

Migration boundary: future migration 5 in section 3 only.

Permissions: refunds.create with invoices.view + payments.view; invoices.cancel for issued cancellation. Manager approval and confirmation authority must be explicit.

### Objective

Support controlled invoice reductions and returning money without creating transferable customer balances.

### Schema, RPC, actions and routes

- Add `credit_notes` tied to one invoice and `credit_note_lines` tied to the credit note, with immutable reductions, GST, `authorised_refund_amount`, reasons, lifecycle, numbering, creator and audit metadata. `authorised_refund_amount` is exact, immutable, no greater than that credit, and is the source of `A`.
- Add `refunds` initially for ordinary payment-scoped payout reservations with invoice/payment/credit context. Do not add `unmatched_provider_event_id` until 4E creates `provider_events`; 4E then additively enables the exceptional Admin-approved evidence return.
- Extend foundation `financial_documents` with credit-note/refund source foreign keys only after their parent tables exist.
- Implement `create_invoice_credit_refund`: atomically issue one line-scoped credit and reserve payout requests only for its authorised cash-return portion (none for a debt-only credit). A debt-only credit has zero authorised cash and creates no refund liability. A partial cash-return credit increases C and A equally, preserving existing unpaid debt. Full cancellation increases C to T and A to G, explicitly waiving remaining debt and returning remaining receipts. Only authorised cash increases refund_due; payout remains bounded by both original-payment capacity and credit authorisation.
- Implement `confirm_manual_refund`: manual approval initially remains `pending`; only evidence of actual cash/EFTPOS/bank payout marks `succeeded`.
- Implement `retry_invoice_refund`: reuse the existing credit and allow a new payout intent only after prior terminal failure is proven. Pending/uncertain payouts continue reserving capacity.
- Enforce payout capacity under invoice/payment/credit locks: per credit, authorised cash minus all effective and in-flight/uncertain payout reservations; per payment, original receipt minus reversal/effective and reserved payouts. The invoice algebra must satisfy all A/C/G constraints after the mutation.
- Activate issued `cancel_invoice`: no-money positive-total cancellation atomically creates the full cancellation credit; a zero-total invoice needs only reason, audit/notice and preserved snapshot, with no zero credit row. After payment, cancellation requires full-sale credit and payouts with `E=0`, `actual_net_cash=0`, `refund_due=0` and no in-flight work.
- Do not create customer-credit or allocation tables. Do not allow a credit note or refund to be transferred to another invoice.
- Add exact staff actions `createRefundAction`, `confirmManualRefundAction`, and `retryRefundAction` beneath invoice detail. Refund UI shows credit effect, original tender, pending payout, maximum and “Does not return stock.”

### Tests and acceptance

- Integration-test concurrent credit/refund limits, a full-sale credit exceeding paid cash, partially paid credit/refund examples, split-tender full cancellation with one credit/multiple payouts, per-credit authorised cash and per-payment caps, pending/uncertain reservation, failed retry credit reuse, any-history reversal prohibition, cross-invoice/location denial, idempotency, exact T/C/G/A/R algebra and zero inventory writes.
- E2E-test credit note creation, refund recording, safe failure messages, invoice history and mobile permission handling.
- Acceptance: every ordinary credit stays on one invoice, every ordinary refund stays on one payment, immutable authorised refund amount exposes refund_due before payout, partial cash-return credit preserves unpaid debt, full cancellation explicitly extinguishes the remaining sale/debt, and payout never exceeds its credit authorization or receipt. Exceptional unmatched-provider tests and activation belong to 4E.
- Dependency: 4C and finalized algebra.
- Stop if implementation implies transferable credit, permits refund without a successful payment, or cannot explain every balance change with append-only records.

## 8. Slice 4E — Stripe Hosted Checkout and webhook reconciliation

Migration boundary: future migration 6 in section 3 only.

Permissions: payments.record for checkout, payments.reconcile for exact branch evidence, payments.view for detail; unknown evidence/exceptional returns and integration configuration hard Admin-only.

### Objective

Accept AUD card payments through Stripe-hosted UI while keeping raw card data outside the application and making provider reconciliation durable and idempotent.

### Schema, provider and routes

- Add the Stripe server SDK to `inventory-app/package.json` at the implementation-time compatible version; pin and review the resolved lockfile. There is no current Stripe implementation to reuse.
- Add `stripe_checkouts` with invoice, amount, currency fixed to `AUD`, provider session/payment identifiers, status, expiry, request fingerprint, timestamps and unique constraints.
- Add `provider_events` with account/mode/event uniqueness, minimal validated payload only, processing/reconciliation state, lease and review evidence. Never store or return a complete raw provider dump.
- Add Stripe columns/foreign keys to `payments`, and unmatched-provider evidence linkage to `refunds`, only after `stripe_checkouts` and `provider_events` exist. Add deferred circular foreign keys after both sides exist; never disable constraints for creation order.
- Before calling Stripe, insert a durable pending checkout/action row in a transaction. If the provider request fails, retain and mark the row recoverably.
- Create Hosted Checkout only for the full outstanding amount. While a non-expired full-outstanding checkout hold exists, block manual payment, credit, refund, revision and other balance-changing mutations. Do not silently release a hold before confirmed expiry.
- Add exact `createPaymentLinkAction` → `prepare_stripe_checkout` and `revokePaymentLinkAction` → `request_checkout_expiry`. Use `POST /api/payments/checkout` with staff session and origin/CSRF protection; `/payment/return` is generic and cannot mutate or disclose invoice state.
- Add `app/api/stripe/webhook/route.ts` using raw signature verification before parse, bounded input/time and durable `ingest_stripe_event` before 2xx. Processing uses `process_stripe_event`, `finalise_stripe_checkout`, `finalise_checkout_expiry`, and `finalise_stripe_refund`; current provider object truth wins over event ordering.
- When an unexpected external payment cannot be safely and exactly matched, record it for `payments.reconcile` review. Never force-match it or mutate an unrelated invoice.
- Add `/payment-reconciliation` and `reconcilePaymentAction` → `request_finance_reconciliation`. Known exact branch evidence may be retried by an authorised reconciler; unknown/cross-branch and exceptional unmatched returns are Admin-only.
- Implement service-only `prepare_unmatched_provider_refund` as the consumer of an Admin-authored reconciliation request. It returns wholly unmatched provider money without a sale credit or AR change; it never partially allocates or force-matches evidence. Capacity is fenced across every event ID for the same account/mode/PaymentIntent using an advisory lock. Once return is approved/started, the funds can never later be matched. Non-AUD money remains provider-side review and is not refunded by the AUD finance ledger.
- A late provider transition from refund succeeded to failed is accepted only when current provider truth and one locked balance transaction prove the merchant received the funds back. Preserve the original success event and append immutable failure evidence; timestamps alone cannot reverse current truth.
- Activate the Stripe continuation of `finalise_pos_sale`: database completion/issue commits first, checkout occurs outside the transaction, and UI remains Awaiting online payment until webhook truth.

### Tests and acceptance

- Unit-test provider status mapping, hold state, signature failure handling and reconciliation classification without live calls.
- Integration-test durable pre-request rows, hold enforcement, expiry, webhook replay/out-of-order events, unique external IDs, full outstanding amount validation, provider success after local timeout, unexpected-payment review, Admin-only unmatched returns aggregated across event IDs for one account/mode/PaymentIntent, return-vs-match races and zero AR/stock effects.
- E2E-test checkout creation using provider mocks, return states and reconciliation permission behavior. Use Stripe CLI only in an explicitly labeled optional implementation test, never as the sole CI proof.
- Acceptance: raw card details never reach the app; checkout is AUD/full outstanding; a durable record predates the external request; webhook replay creates one payment; active holds prevent conflicting manual changes; unsafe matches remain review items.
- Dependency: 4C and 4D balance rules.
- Stop if webhook signatures are not verified, secret keys enter client bundles/logs, a provider retry can duplicate payment, or an active hold permits a conflicting mutation.

## 9. Slice 4F — financial documents and Resend delivery

Migration boundary: future migration 7 in section 3 only.

Permissions: documents.send plus source view permission; receipts additionally payments.view; private document access enforces branch and entity permissions. Sender/secrets configuration hard Admin-only.

### Objective

Generate immutable revision-specific financial documents and deliver them through Resend with durable, auditable delivery state.

### Schema, provider and routes

- Extend the foundation `financial_documents` envelope for deterministic rendering/storage and document-type source relations; do not create a second document table. Use exact entity/revision, immutable snapshot, storage identity, SHA256 content hash and pinned template/render version. No alternate-rendition/history subsystem.
- Add `email_deliveries` describing recipient, template/document/entity, requested state, idempotency key and final review state.
- Add append-only `email_delivery_attempts` for every provider attempt with provider request/message ID, timestamps, normalized outcome and safe error metadata.
- Generate invoice documents from the exact immutable invoice revision, credit notes from exact credit lines and receipts/refunds from exact payment/refund records. Reprints return original bytes. Missing bytes may be restored only from the same snapshot/pinned renderer/template with the original SHA256; otherwise raise DOCUMENT_RECOVERY_REQUIRED. A new template applies only to newly issued documents and never replaces historical official bytes. Include tax invoice, receipt, credit/adjustment, refund confirmation and payment correction notice.
- Add `GET /api/documents/[id]`, using `finance_document_access` plus entity/branch permissions and private no-store streaming or a signed URL valid at most 60 seconds. UUID possession is not authority.
- Add the inventory-owned server-only `lib/finance/email.ts` adapter and Resend dependency only when this slice begins. The public site has reusable delivery ideas in `app/api/enquiries/route.ts` and direct REST examples in `app/lib/membership-email.ts`, but marketing credentials/templates/routes are not reusable deployment configuration.
- Keep all Resend keys and sender configuration server-only. Validate configured recipient/sender/domain before attempting delivery.
- Implement exact actions `sendInvoiceAction`, `sendReceiptAction`, `sendCreditDocumentAction` → `enqueue_finance_email`; `retryDeliveryAction` → `retry_finance_email`; and `updateInvoiceDeliveryAction` → `update_invoice_delivery_preferences`. Worker RPCs are `claim_finance_work`, `finalise_finance_document`, `finalise_finance_email`, and `record_finance_attempt`.
- Resolve recipients in the fixed order: explicit invoice billing selection/override; active billing contact (primary, then stable created/id); customer billing email; accounts email; customer email. Snapshot selection and suppress visibly when absent/invalid.
- Retry an unknown outcome with the same key only inside Resend's 24-hour window using bounded 1/5/30-minute/2-hour backoff, maximum five attempts including initial. Beyond 24 hours mark `needs_review` and require explicit acknowledgement to send another copy as a new preserved intent.
- Use a pinned deterministic server PDF renderer, private `finance-documents` storage and immutable source snapshots/bytes/hashes. Allocate RCT once per successful payment using the general numbering helper. Do not include costs/internal notes/provider IDs.

### Tests and acceptance

- Unit-test document-to-revision selection, recipient validation, template data, redaction and provider outcome mapping.
- Integration-test document immutability, unique delivery requests, attempt history, known provider failure retry, uncertain timeout transition after 24 hours, same-key uncertain retry within the valid window, no automatic uncertain retry beyond it, and cross-location access.
- E2E-test download/send/status/review UI with mocked Resend and mobile layouts.
- Acceptance: a sent invoice remains traceable to its exact revision; no cost data enters customer documents; every send has durable request/attempt history; uncertain sends become human-review work without duplicate automatic mail.
- Dependency: 4D; Stripe receipt cases may additionally depend on 4E.
- Stop if a document can silently change after sending, a secret or cost field is rendered, or uncertain delivery is retried outside valid same-key/payload provider deduplication coverage.

## 10. Slice 4G — durable daily reminders

Migration boundary: future migration 8 in section 3 only.

Permissions: documents.send with source view for delivery preferences; receivables.view + documents.send for staff follow-up; settings hard Admin-only; cron/service RPCs service-only.

### Objective

Run a daily, authenticated and idempotent reminder process that stages eligible invoices durably and delivers without duplicate reminders.

### Schema, cron and routes

- Add `reminder_deliveries` keyed uniquely by invoice/stage only (never due cycle or revision), with eligibility snapshot, staged/suppressed/sent/review state, timestamps and uniqueness.
- Expose the fixed reminder schedule/shared-sender policy and Admin activation flags defined by the design; do not add configurable stages or due-cycle uniqueness.
- Add one daily Vercel Cron registration, proposed `0 23 * * *`, and exact `GET /api/cron/finance`. Require exact bearer `CRON_SECRET` with constant-time comparison in every environment; registration/activation remains a rollout action.
- The cron transaction must identify eligible invoices and durably stage one `reminder_deliveries` row per invoice/stage before any provider call. It must not send directly from an ephemeral scan without the durable stage.
- Process staged reminders through the 4F delivery pipeline. Re-runs and overlapping invocations must observe uniqueness and avoid duplicates.
- Stages are exactly `before_due_3`, `due`, `overdue_7`, `overdue_14`, unique by invoice/stage. Skip pre-due before issue; delayed cron stages only the latest eligible unsent stage and marks older stages skipped; overdue_14 never recurs. Unpaid revision only reschedules unsent/unclaimed stages.
- Add the deferred `email_deliveries.reminder_delivery_id` / `reminder_deliveries.email_delivery_id` pairing only after both tables exist, with explicit creation-order constraints rather than disabled checks.
- Suppress cancelled, settled, explicitly suppressed, invalid-recipient and review-held invoices; record reason. Terms/due date freeze once any reminder is claimed for external dispatch or sent. After payment reversal, run the latest eligible unsent stage even when the date is beyond day 14; if every stage is already sent/skipped, create a mandatory “Reopened debt — staff follow-up required” flag derived from reversal time and delivery history, clearable only by audited manual-send/follow-up reason.
- Select candidate IDs without locking outbox rows; acquire request/invoice locks before document/outbox claims in global order. Re-evaluate eligibility immediately before dispatch. Payment before the dispatch claim suppresses send; an email already in flight cannot be recalled. The dispatch claim is the linearisation point; include “disregard if recently paid”. Add recordReceivableFollowupAction / record_receivable_followup with receivables.view + documents.send, branch/version and mandatory audited follow-up reason; no ledger mutation.

### Tests and acceptance

- Unit-test reminder schedule dates, timezone boundary and suppression rules.
- Integration-test overlapping daily runs, retry after crash between stage/send, payment after stage, uncertain email outcome, setting changes and location isolation.
- E2E-test Admin reminder settings and operational review/status surfaces with provider mocks.
- Acceptance: two simultaneous cron runs stage at most one reminder per invoice/stage; a crash is recoverable; settlement before dispatch prevents a new claim/retry, while the documented in-flight acceptance race is tested; every decision is auditable.
- Dependency: 4F and finalized AR due-date policy.
- Stop if the cron secret is optional, a provider call precedes durable staging, eligibility is not rechecked, or duplicate sends are possible.

## 11. Slice 4H — security, concurrency, observability and release hardening

Migration boundary: future migration 9 in section 3 only.

Permissions: verify the exact 13-key inventory from 4A and all existing source/read dependencies; add no grantable settings key or automatic Manager grant.

### Objective

Close cross-feature gaps, prove all money invariants under concurrency and prepare a controlled rollout without weakening existing inventory behavior.

### Hardening work

- Review every one of the 18 finance table grants, RLS policies, SECURITY DEFINER empty search paths, function-family ACLs, direct-table mutation denials, private storage policies and API/server-action permission checks. Verify no global default privilege change.
- Verify the 4A foundation extension of `audit_events_actor_role_check` from `admin,manager` to `admin,manager,system` retained every row; do not defer this prerequisite to 4H. Stripe/worker events use `actor_user_id NULL`, `actor_role system`, and `details.actor_kind` of `stripe` or `worker` through a private service-boundary helper; never forge an `auth.users` actor or fake system customer.
- Confirm Managers cannot escape location scope and cost permissions cannot be inferred from invoice totals/documents/errors.
- Standardize finance sentinel errors in `lib/finance/errors.ts`; log correlation/action/provider IDs without payloads, secrets or unnecessary customer data.
- Add indexes and query plans for invoice search, AR aging, provider-event backlog, delivery review and reminder eligibility.
- Add operational review queues for provider events, Stripe checkouts, email deliveries and reminders in `needs_review`/failed states.
- Add retention, replay and recovery runbooks without deleting immutable finance history.
- Upgrade the feature branch onto the clean current integration baseline before final validation. Preserve every existing migration filename, especially `20260905003608_phase_3b_sales_picker_search.sql`, and resolve migration order only by assigning later timestamps to new files.

### Tests and acceptance

- Add concurrency tests for issue/revise/pay/credit/refund/cancel/checkout-hold collisions and repeated provider events.
- Add malicious-client integration tests that call RPCs directly, alter location/amount/version/discount/cost fields and attempt cross-entity references.
- Run all existing inventory unit, integration and E2E suites, including mobile, plus new finance suites on a throwaway local Supabase.
- Extend `.github/workflows/inventory.yml` with both a clean all-migration install and exact Phase 3B-baseline upgrade/canonical catalog comparison, DB lint/advisors/ACL checks, provider mocks and signed webhook fixtures. Pin Supabase CLI and new SDK/renderer versions during implementation instead of retaining `latest` as a future correctness dependency.
- Acceptance: all invariants survive concurrent and direct RPC attempts, old suites pass on the upgraded clean baseline, review queues recover injected failures, and rollout gates below are documented and witnessed.
- Dependency: 4A–4G.
- Stop on any unresolved high-severity security/data-integrity finding, flaky money-concurrency test, migration drift, unexplained reconciliation difference, or missing recovery path.

## 12. Failure and recovery matrix

| Failure | Required durable state | Automatic behavior | Operator recovery |
|---|---|---|---|
| Invoice action request times out before response | `finance_action_requests` records request/fingerprint and any committed result | Same-key/same-payload retry returns the prior result | Inspect by request ID; never create a second invoice/payment |
| Concurrent invoice creation for one job | Unique job/invoice constraint plus one winning action result | Loser resolves to existing invoice only when replay semantics are valid | Review request audit if fingerprints differ |
| Stale invoice/job revision | Existing row/revisions remain unchanged | Return safe version-conflict error | Reload current version and deliberately resubmit |
| Partial job-to-invoice transaction | No partial commit | Transaction rolls back | Correct cause and retry same request key |
| Manual payment races another balance mutation | Locked invoice; at most one valid mutation commits | Reject stale/overpaying mutation | Reload balance and record a new authorized action |
| Wrong manual payment amount | Original payment immutable | No automatic edit | Append full reversal, then record correct payment |
| Active Stripe checkout plus manual mutation | Durable unexpired full-balance hold | Block manual balance changes | Confirm expiry/provider state; reconcile before release |
| Stripe create request fails before provider call | Durable checkout marked failed/retryable | Safe retry follows request fingerprint policy | Retry or close failed request; do not assume session exists |
| Stripe provider succeeds but local response is lost | Pending checkout remains; webhook/provider event later arrives | Webhook reconciles idempotently | Query provider by durable request metadata; do not create blind replacement |
| Stripe webhook duplicate/out of order | Unique `provider_events` row and append-only attempt/state history | No duplicate payment; defer impossible transition | Replay after prerequisite event or mark for reconciliation review |
| Unexpected Stripe payment | Provider event/payment candidate in review state | Never force-match | Authorized reconciliation verifies invoice and amount or records external resolution |
| Wholly unmatched provider funds must be returned | Admin reconciliation request plus provider evidence-linked refund; no invoice/payment/credit link | Service prepares original-method return only from approved evidence | Verify provider outcome; AR, sale credit and stock remain unchanged |
| Refund credit approved but payout fails/times out | Credit remains issued and refund_due visible; payout remains failed or needs_review and reserves capacity when uncertain | Never roll back or duplicate credit; no manual fallback until Stripe non-success is proven | Retry payout against the existing credit after terminal failure proof |
| Provider reports late refund failure after earlier success | Immutable success event plus appended verified failure evidence | Change effective state only when current provider truth and a locked balance transaction prove merchant funds returned; timestamps/stale failure cannot override truth | Restore refund_due and retry the existing obligation only after proof |
| Resend known rejection | Delivery plus failed attempt | Retry only under defined safe policy | Correct configuration/recipient and explicitly retry |
| Resend timeout/unknown result | Attempt remains uncertain | After 24h mark `needs_review`; no automatic retry | Check Resend evidence, then mark delivered/failed or explicitly retry |
| Cron overlaps or reruns | Unique staged `reminder_deliveries` row | Existing stage reused; no duplicate send | Resume staged work safely |
| Payment arrives after reminder staging | Reminder stage retained with suppression evidence | Eligibility recheck suppresses any dispatch not yet claimed | Inspect suppression; a message already in flight cannot be recalled |
| Document render fails | Entity/revision remains intact; failed generation recorded | No email send | Fix renderer/config and regenerate against same immutable source |
| Production provider/config unavailable | Application remains operable for unaffected functions | Provider-dependent action fails closed | Restore server-only config and run controlled smoke test |
| Rollout regression | Additive schema remains; feature entry points can be disabled | Stop rollout | Roll back application deployment; preserve financial records and reconcile in-flight provider events before retry |

## 13. Ten controlled rollout gates

Each gate requires named human sign-off and recorded evidence. Do not skip ahead when a gate fails.

1. **Approved release gate:** exact release SHA/merge is approved and complete CI is green.
2. **Provider configuration gate:** Stripe test mode, Resend sender, server-only secrets and endpoint authentication are verified; automation flags remain off.
3. **Production preflight gate:** verify exact Vercel/Supabase identity, migration history, immutable opening evidence and current live ledger without assuming historical zero counts remain current.
4. **Migration review gate:** review the exact additive migration dry run against the verified production history; no renamed old migration or global default privilege change.
5. **Migration apply gate:** separately authorize and apply only the reviewed additive migrations.
6. **Database postflight gate:** verify schema, function ACLs, RLS, constraints, numbering, migration equivalence and financial/inventory invariants.
7. **Deployment gate:** prove the exact deployed Git SHA, Vercel project, READY state and custom-domain alias separately; READY alone is insufficient.
8. **Read-only smoke gate:** authorized Admin and Manager sessions verify auth, branch, permission, list/detail/document protection and provider-health surfaces without creating finance records.
9. **Controlled provider gate:** separately authorize controlled test/live Stripe and email acceptance, then reconcile provider, audit, document and AR evidence.
10. **Activation gate:** separately authorize live checkout, email and reminder flags/schedule. Start with no new Manager finance grants or positive discount cap until the owner assigns them.

## 14. Rollback strategy

Because migrations are additive and financial history is immutable, rollback means deploying the previous compatible application and disabling new write entry points, cron and provider checkout creation. Do not drop tables, delete rows, rewrite migrations, reverse payments by SQL, or erase provider events.

Before rollback, stop new checkout/reminder creation, preserve webhook ingestion when compatible, identify all pending `stripe_checkouts`, `provider_events`, `email_deliveries`, `reminder_deliveries` and finance action requests, and reconcile their external state. After redeployment, verify existing inventory/jobs/POS behavior, keep finance data read-only if needed, and prepare a forward fix. A database down-migration is not the default recovery mechanism.

## 15. Verification commands

### Future implementation baseline verification only

Do not run these commands during planning closure. They install dependencies, run application tests or operate disposable infrastructure and are reserved for separately authorised implementation. Run from PowerShell in the later implementation worktree; the planning worktree below is only the current path reference:

```powershell
Set-Location -LiteralPath 'C:\Users\abuba\.worktrees\247truck-phase-4-plan\inventory-app'
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

The current integration/E2E gate requires Docker and a disposable local Supabase only. Confirm the target is local before reset:

```powershell
Set-Location -LiteralPath 'C:\Users\abuba\.worktrees\247truck-phase-4-plan\inventory-app'
supabase start
supabase status -o json
# Export the local values under the CI variable names; do not print or commit them.
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY,
# SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ALLOW_DESTRUCTIVE=true,
# NEXT_PUBLIC_INVENTORY_APP_URL=http://localhost:3100
supabase db reset
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

### Future Phase 4 verification labels

The following commands become runnable only after Phase 4 tests and provider mocks are implemented. Exact focused filenames/scripts must be supplied by the slice that creates them; do not claim these gates on the current baseline:

```powershell
# FUTURE: focused finance unit tests
npm run test:unit -- finance

# FUTURE: focused finance integration tests on disposable local Supabase
npm run test:integration -- finance

# FUTURE: mocked finance browser acceptance
npm run test:e2e -- invoices payments receivables

# FUTURE: full release gate after all slices
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:integration
npm run test:e2e
```

Provider sandbox checks and controlled production smoke tests require separately authorized test data and configured server-only variables. They are rollout gates, not substitutes for automated local tests.


## 16. Configuration/activation decisions remaining

1. **USER DECISION REQUIRED #1 — identity:** actual legal/business name, ABN, approved logo, shared sender/reply address, business address/phone, Lonsdale and Regency Park address/contact, bank/payment instructions and invoice footer. Never guess values.
2. **USER DECISION REQUIRED #2 — permissions:** which Managers receive each finance permission, each discount cap and explicit acknowledgement of refunds.create approval/confirmation authority. Safe default: no new Manager finance grants and NULL/zero positive-discount authority.
3. **USER DECISION REQUIRED #3 — providers:** actual Stripe account and live activation approval, verified Resend sender, email automation and reminder activation. Later implementation/test mode may be prepared; live activation requires separate explicit rollout approval.

These are configuration/activation decisions, not unresolved implementation design. Phase 4A is not authorised in this planning session.
