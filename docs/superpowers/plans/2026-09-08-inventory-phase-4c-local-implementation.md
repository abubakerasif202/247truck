# Phase 4C local implementation plan and evidence ledger

## Authority and baseline

User-authorized scope: local implementation and verification only. No push, PR, merge, deployment, production SQL, production records, Manager grants, Stripe/Resend/cron activation or Phase 4D. Phase 4B is closed/live and is not rolled out again.

Verified 2026-09-08 origin/main: `2e954f115269a43215c75ee15dd7eec615004e07`. The main working tree remains on its existing older commit with untracked `.agents/`, `AGENTS.md`, `CLAUDE.md`, `inventory-app/x`, and `skills-lock.json`; preserve them. No Phase 4C branch or worktree existed. Planning begins on `docs/inventory-phase-4c-plan` at `C:\Users\abuba\.worktrees\247truck-phase-4c-plan`. Implementation branches from this planning commit into a separate worktree.

Authority: the 2026-09-06 Phase 4 master design and companion implementation plan, especially design sections 4, 5, 7–9, 15–18, 20–23 and plan slice 4C. Released foundation migrations are `20260905183057_phase_4a_finance_foundation.sql`, `20260905183500_phase_4a_invoice_revisions_settings_discounts.sql`, and `20260906120000_phase_4b_invoice_job_pos_workflow.sql`. All historical migrations remain byte-identical.

## Decision gate: manual reconciliation

The master contract for `request_finance_reconciliation` and `payment_reconciliation_summary` describes verified provider evidence; provider tables arrive in 4E. It does not define a manual reconciliation state or persistence schema. User clarification requested: append an audited review of an existing manual payment with evidence reference, reason and actor, changing neither balance nor payment status; alternatively defer reconciliation. Do not invent a new reconciliation table or activate provider machinery. This specific batch is blocked pending the decision; all independent batches below are specified and may proceed.

## Database contracts

One additive migration: `20260908120000_phase_4c_manual_payments_receivables.sql`. Only new tables `payments` and `payment_reversals`, exactly the manual subset of the master inventory. Add Phase 4C FK/source support to existing `financial_documents`, expand action-request vocabulary and replace relevant read projections additively. No cache/allocation/wallet/audit tables.

Payments: UUID identity, one invoice/revision composite FK, invoice-matching location/customer, cash/eftpos/bank_transfer manual methods, positive `numeric(14,2)` AUD amount, immediately succeeded, reference/notes/received_at, actor, unique request UUID, timestamps/version. Reject excess decimal precision before casting. Reversals: unique original payment, matching invoice/location, full original amount, required reason/actor/request/timestamp; immutable append-only. Manual source rows are immutable. `first_payment_at` uses first successful recording time, remains permanent and blocks revision even after full reversal.

All tables RLS enabled; direct privileges revoked from PUBLIC/anon/authenticated/service_role. Every SECURITY DEFINER function has empty search_path, qualified references, explicit grants/revokes and active actor/branch checks. No seeded permissions. Financial references/history require payments.view separately from invoice aggregate visibility; receivables.view does not imply invoice PII access or cost authority.

Mutations: `record_invoice_payment(p_request_id,p_invoice_id,p_expected_version,p_tenders)` and `reverse_manual_payment(p_request_id,p_invoice_id,p_payment_id,p_expected_version,p_reason)`. Tenders are a bounded ordered array of allowlisted method, amount decimal string, reference, notes and optional received_at. Bank reference policy is warning-only on repeated references, never global uniqueness because one bank deposit may be entered against several invoices. A full reversal followed by a new payment is the only correction path. Reversal is not refund/cash payout. Empty/zero/negative/overprecision/overflow tenders, draft/cancelled payment, stale versions and overpayment fail atomically.

Use existing finance_request and finance_request_finish, include target entity IDs in every fingerprint, authorize before replay, replay before version rejection. Deterministic tender UUIDs derive from outer intent and array position. Invoice version increments once for a tender batch. Receipt/correction intents and audit commit with money; rendering/delivery remain inactive. Adjust the existing per-revision tax-invoice uniqueness into a partial tax-invoice index before multiple receipt intents can coexist.

Read projections derive total, gross succeeded, reversed, effective paid, balance, unpaid/partial/paid and overdue from one snapshot. In 4C credits/refunds are zero, not table references. Due/aging uses Australia/Adelaide date and Current, 1–7, 8–14, 15–29, 30+. Bound filters and use deterministic cursor ordering with UUID tie-break. Retain existing invoice_detail fields and cost isolation. Implement receivables_summary and customer_receivables; extend invoice_detail and invoice_summary safely with compatible callers.

## POS composition

Activate `finalise_pos_sale` and `finalisePosSaleAction` for manual tender/business on-account only. Support new POS creation and existing draft updates through released create_job/update_job, then released complete_job, finance_build_job_invoice, issue and tender within one transaction. Use stable outer UUID and deterministic child keys. Require pos.use, jobs.view/create/edit/complete, invoices.view/create/issue and payments.view/record when tender is present. Individual/walk-in must settle fully; business may leave balance on account; zero-total has no payment rows.

Lock order: outer finance advisory request -> all deterministic child sales-request locks sorted -> job -> invoice -> payment UUID order -> document/audit. Avoid nested public finance calls that acquire new outer locks after job/invoice: use narrowly scoped private helpers extracted in the new migration where necessary. Do not pre-lock inventory. Released complete_job retains stock/reservation/used-unit/WAC authority. Failure after completion, after invoice or at audit must roll back all effects, including child requests; replay and adversarial standalone completion race cannot double consume.

## Ordered TDD batches and ownership

1. Payment schema/RPC/read projection integration tests first; observe failures on exact 4B, then implement new migration. Cover splits, balances, dates, duplicates/mismatch, overpayment races, full reversal/replay, permanent lock, ACL/RLS/branch/cost and zero inventory delta.
2. POS transaction integration tests first; implement a separately owned SQL fragment assembled into the one migration. Cover create/update, manual/on-account/zero totals, exact-once stock and used tyre consumption, stable child lock race and injected downstream rollback.
3. Application validation/action/component unit tests first; implement manual payment/reversal forms, history/balances, receivables filters/navigation and POS finalisation using existing styles/forms and permission guards. Preserve stale input and request IDs across retry; display safe errors. Add desktop and 320px rendered E2E workflows, permission denial and no horizontal overflow.
4. Reconciliation only after its decision gate. Record the approved contract and test permission/evidence/idempotency with no financial or inventory changes.
5. Independent code/security review, fix findings, full regression and database equivalence verification. Review all changes centrally before recording final status.

## Local verification and evidence

Node observed v22.23.1/npm10.9.8; inventory-app requires Node22, Next16.3.3, CLI observed2.117.0. Read installed Next local guides before code. Use npm ci with unchanged lockfile. No host usage-percentage tool is exposed; do not infer percentages. Bound parallel workers to three and inspect results between waves.

Docker Desktop was stopped and has been started. Existing local-only stack is `supabase_db_247truck-inventory` with loopback API55331 and DB55332; observed migration history ends at exact4B. Before reset, preserve a local database dump and verify target name/ports; no production link/environment is used. Reset/install applies only to this explicitly disposable stack. Keep env credentials in ignored local files without logging them.

Prove exact baseline by installing original migrations through 4B unchanged, seed local fixtures, then apply 4C through local migration up. Compare public/private schema dumps and migration contents/catalog evidence against a clean all-migration install, normalizing only nonsemantic dump noise. Never repair/rename history. Preserve upgrade artifacts outside tracked source. Then run the full existing and new suites against the clean disposable database:

```powershell
Set-Location -LiteralPath 'C:\Users\abuba\.worktrees\247truck-phase-4c\inventory-app'
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run test:e2e
git diff --check
```

Run no destructive command until the local target is verified. Do not count skipped tests as passes or weaken assertions. Record exact counts, migration filenames/RPCs, baseline/planning/implementation SHAs, review findings and remaining blockers in final evidence. No release action follows verification.

## Execution ledger

- [x] Fetch and verify baseline; preserve main work; establish isolated planning branch.
- [x] Translate master Phase 4C into independently implementable contracts and gates.
- [ ] Resolve manual reconciliation decision.
- [ ] Commit plan locally; create isolated implementation branch.
- [ ] Baseline failing tests for each batch.
- [ ] Implement and pass focused batches.
- [ ] Exact 4B upgrade and clean-install equivalence.
- [ ] Full static/unit/integration/build/E2E and desktop/320px verification.
- [ ] Independent review resolved and local implementation commit/report.
