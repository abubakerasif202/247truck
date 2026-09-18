# Receipt cost correction — MANUAL BUSINESS DECISION — REQUIRED BEFORE COST-CORRECTION FEATURE

## Why this exists

`receive_purchase_order` writes each receipt line's `unit_cost` into an
append-only, forward-only ledger: every stock movement carries the
weighted-average cost (WAC) computed from the balance *at that moment*, and
every later movement's WAC depends on all the movements before it. Nothing in
the schema or the RPC surface lets a user correct a wrong receipt cost after
the fact — there is no `correct_receipt_cost` RPC, and none is being added by
this pass. If a receiving clerk fat-fingers a unit cost (e.g. enters $130
instead of the invoiced $103), the only paths today are: leave it wrong, or
have an engineer hand-edit rows in `inventory_movements` /
`inventory_balances` directly, outside any audited RPC.

This document is **not an implementation** of a fix. It exists so that
whoever builds a cost-correction feature later starts from an explicit
decision rather than an implicit one made by whichever option is easiest to
code that week. Each option has real, different consequences for stock
valuation, gross margin reporting, audit history, and already-issued
invoices. None is free.

## Background: why this is hard

- **WAC is sequential.** `inventory_balances.weighted_average_cost` after
  movement *N* is a function of the balance after movement *N-1* and movement
  *N*'s own quantity/cost. Changing a historic receipt's cost without
  replaying every movement after it leaves the *current* WAC exactly as wrong
  as it was, or wrong in a new way, depending on how the correction is
  applied.
- **Stock sold since the bad receipt already captured a cost.** Jobs and POS
  sales capture `captured_unit_cost` on `job_lines`/`inventory_movements` at
  the moment of sale, from whatever WAC was current then. Correcting the
  origin receipt does not retroactively change what was already recorded as
  sold at the wrong cost, unless something explicitly walks forward and
  rewrites those captures too.
- **Invoices are immutable once issued.** `private.finance_revision_guard`
  and `private.finance_immutable` hard-block any UPDATE to an issued
  invoice's revision or line rows (`FINANCE_HISTORY_IMMUTABLE`,
  `INVOICE_FINANCIAL_LOCKED`). Whatever margin was implied by an issued
  invoice's captured cost cannot be rewritten in place — only reported on
  separately or corrected via a new, separate accounting event.
- **The receipt itself is a real business record.** `goods_receipts` /
  `goods_receipt_lines` represent what the receiving clerk actually recorded
  at the dock. Overwriting them in place destroys the record of what was
  originally entered, which auditors and suppliers may need to see.

## Option A — Preserve the original receipt; add a separate, audited cost-correction event that rebuilds WAC forward

**Mechanism.** The original `goods_receipt_lines` row and its original
`inventory_movements` row are never touched. A new RPC
(`correct_receipt_cost` or similar, not yet designed) inserts a distinct,
clearly-labelled correction event referencing the original receipt, then
walks every `inventory_movements` row for that product/location with a
timestamp at or after the original receipt and recomputes
`weighted_average_cost` forward from the corrected starting cost, updating
each row's recorded WAC and the current `inventory_balances.weighted_average_cost`.

**Implications.**
- *Stock/WAC:* Current WAC becomes correct. Historic WAC-at-time-of-movement
  values for everything after the bad receipt also change, which is a
  legitimate restatement but means "the WAC this job/sale used" is no longer
  a fixed historical fact — it becomes "as last corrected."
- *Margin:* Gross margin on every sale between the bad receipt and now is
  effectively restated. If those sales are reported on somewhere (period P&L,
  a margin dashboard), those reports either need to be re-run or will
  silently disagree with what they showed before the correction.
- *Audit:* Full history preserved — both the original (wrong) event and the
  correction are visible, and the correction event should record what
  changed and why. This is the most audit-friendly option in the sense that
  nothing is destroyed, but it is also the most complex to make
  demonstrably correct (a forward-replay across an unbounded number of
  intervening movements, computed inside one transaction).
- *Invoices:* `captured_unit_cost` on invoice lines from issued invoices
  remains untouched (immutability guard forbids updating it) — those
  invoices continue to *display* the original, now-known-wrong cost/margin
  forever, even after the ledger itself is corrected. This is a real
  inconsistency between the ledger and historical invoice records that this
  option does not resolve.
- *Blast radius:* Highest of the three. Requires new SECURITY DEFINER logic
  that mutates a potentially large number of historic `inventory_movements`
  rows inside one transaction, careful locking (the same lock-order class of
  bug already hardened elsewhere in this pass), and new tests proving the
  replay is exact for every intervening movement type (sales, transfers,
  other receipts, reconciliation adjustments).

## Option B — Reverse the original receipt; enter a corrected replacement receipt

**Mechanism.** A new RPC posts a reversing stock movement for the original
receipt's quantity at the original (wrong) cost, then posts a new receipt at
the corrected cost as an ordinary `purchase_receipt` movement, both linked to
the original `goods_receipt_lines` row for traceability. `WAC` is recomputed
naturally by the existing movement-posting logic, using its current formula,
based on the balance at the time the reversal+replacement post — i.e. *now*,
not retroactively.

**Implications.**
- *Stock:* `on_hand` is unaffected net (reversal and replacement cancel out
  in quantity), assuming none of the originally-received units have since
  been sold or transferred out. If some already left (sold, transferred),
  the reversal can drive `on_hand` negative or fail outright — this option
  only cleanly applies to a receipt still fully on the shelf.
  A regression test would need to prove the RPC refuses to reverse a
  quantity greater than what remains on hand for that product/location,
  rather than allowing on-hand to go negative.
- *WAC:* Corrected going forward from *now*, not retroactively. Every WAC
  value between the original receipt and now stays exactly as it was
  (still wrong, since it was computed against the bad cost) — this option
  does not restate history, it only fixes the number going forward.
- *Margin:* Sales between the original receipt and the correction keep
  whatever margin they already recorded. Only sales from this point forward
  reflect the corrected cost.
- *Audit:* Two new, clearly-linked movements (reversal + replacement)
  alongside the original — nothing is deleted or overwritten. Simpler to
  reason about and test than Option A, because it never touches a historic
  row.
- *Invoices:* Same limitation as Option A — issued invoices already captured
  the wrong cost and cannot be rewritten.
- *Blast radius:* Moderate. Reuses the existing single-movement posting path
  twice (reversal, replacement) rather than requiring a multi-row forward
  replay. The main new logic is the "still fully on hand" guard and its
  failure mode.

## Option C — Prohibit application-level correction; require authorised accounting/DB reconciliation

**Mechanism.** No new RPC. A wrong receipt cost is corrected only by an
authorised person executing a reviewed, logged SQL script directly against
the database (or a future accounting-system integration), outside the
application's normal RPC surface, following a documented runbook.

**Implications.**
- *Stock/WAC/margin:* Whatever the manual script does — entirely outside
  this application's guarantees, guards, and audit-event conventions. The
  reviewer of that script is personally responsible for getting the WAC math
  right, for not violating `FINANCE_HISTORY_IMMUTABLE`/
  `INVOICE_FINANCIAL_LOCKED` on issued invoices (or explicitly deciding to
  bypass them, e.g. by disabling the trigger for the duration, which is
  itself a real risk), and for not corrupting concurrent movements if run
  while the system is live.
- *Audit:* No `audit_events`/`sales_audit` row is produced automatically —
  whoever runs the correction must manually record what was done and why,
  outside the application's own audit trail, unless the runbook mandates a
  manual `audit_events` insert as its final step.
- *Invoices:* Same fundamental limitation as A and B — issued invoices are
  immutable regardless of who is running the correction.
- *Blast radius:* Lowest in terms of new application code (none), but highest
  in terms of operational risk per correction, since every correction is a
  bespoke, unreviewed-by-the-application manual operation.

## Recommendation framing (not a decision)

This document does not choose an option — that is the point. For what it is
worth: Option B is the smallest, most testable unit of new work and never
touches historic rows, but it visibly does not fix historic margin
reporting; Option A is the only option that actually corrects historic WAC,
at meaningfully higher implementation and testing cost; Option C defers all
of that cost and risk to a human, indefinitely. Whoever owns the finance
module should pick one before a `correct_receipt_cost`-shaped RPC is written,
not while writing it.
