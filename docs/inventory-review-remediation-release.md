# Inventory review remediation — release runbook

Branch `fix/inventory-review-remediation` (based on `c4f39af`). Covers the eight
source-review findings: receivables/inventory pagination, database-side dashboard
totals, overdue filtering, `cancel_invoice` idempotency, explicit finance error
states, Admin branch scope, paid-invoice exclusion, and durable invoice e-mail
send requests.

## Schema change

One forward-only migration:

`inventory-app/supabase/migrations/20260912120000_review_remediation_pagination_scope.sql`

What it does (all additive or `create or replace`):

| Object | Change |
| --- | --- |
| `inventory_summary_page`, `inventory_dashboard_metrics` | New RPCs. Require `inventory.view`; branch scope and cost gating inherited from `inventory_product_summary`. |
| `customer_receivables_v2` | New RPC: keyset pagination (`due_date` NULLS LAST, `id`), `has_more`/`next_cursor`, default view = positive balance only. |
| `customer_receivables` | Same signature; now delegates to `_v2` and returns its `rows` (array, superset of the old fields). Semantics change: paid invoices are no longer in the default view. |
| `invoice_summary_v2` | Same signature; overdue = past due AND balance > 0, independent of partial payment. |
| `cancel_invoice` | Same signature; fingerprint covers only the caller's request. Generated credit lines / refund allocations go to audit event `INVOICE_CANCELLATION_GENERATED`. |
| `private.finance_cancel_legacy_replay` | Recognises identical retries of requests stored by the previous `cancel_invoice` (reconstructs the legacy fingerprint from the credit note that request created). |
| `finance_request_outcome` | New read-only RPC: what a request id already recorded (same actor or Admin). |
| `invoice_email_send_requests` | New table (mutable request state; one provider idempotency key per logical send, 24 h key window). |
| `invoice_email_deliveries` | Adds nullable `send_request_id`, `attempt_number`; allows `delivery_state = 'uncertain'`. Immutability triggers untouched. |
| `begin_invoice_email_send`, `finish_invoice_email_send`, `invoice_email_send_status` | New RPCs. `record_invoice_email_delivery` is retained. |

Behaviour change to announce: **`inventory.view` is now enforced** in the
database for the inventory list, product page, stock pickers and dashboard stock
totals. Managers lacking it (the invite form defaults it on) will be redirected
from those pages. Grant the permission before deploying if any active Manager
lacks it:

```sql
select p.display_name from public.user_profiles p
where p.role='manager' and p.active
  and not exists (select 1 from public.manager_permissions m where m.user_id=p.user_id and m.permission_key='inventory.view' and m.enabled);
```

## Deployment order

1. Merge the PR; do not deploy the app first.
2. Apply the migration (`supabase db push` from CI or `supabase migration up`
   against production). It is additive; no rows are rewritten.
3. Deploy the app build from the same commit.
4. Smoke checks: `/inventory` and `/receivables` as Admin (all + one branch) and as a
   Manager; open an invoice and confirm the e-mail panel shows "Send invoice"; the
   dashboard shows stock totals.

The previous app build remains compatible with the migrated schema (verified by
`scripts/verify-migration-upgrade.sh`): it calls `customer_receivables`,
`invoice_summary_v2`, `cancel_invoice`, `record_invoice_email_delivery` and the
`inventory_product_summary` view with unchanged signatures and reads only fields
that still exist.

## Rollback

Do **not** drop the new functions or the `invoice_email_send_requests` table:
`invoice_email_deliveries.send_request_id` references it, delivery rows are
immutable, and audit events already point at request ids.

Preferred: **roll the app back and keep the schema.** The old build works against
the migrated database (see above). The only semantic differences it will observe
are the intended fixes (paid invoices absent from the default receivables view,
partially-paid overdue invoices listed as overdue).

If a database-level defect is found, ship a **forward corrective migration**
(`create or replace` the affected function). Never edit or delete
`20260912120000_*`, and never touch `finance_action_requests`,
`invoice_email_deliveries`, `credit_notes`, `refunds` or `audit_events` rows.

## Cancellation retries and reconciliation

- A retry of a cancellation with the same request id and identical details
  replays the stored result — including requests recorded by the previous
  `cancel_invoice` (compatibility path).
- If the request id is reused with different details, the UI now reports what
  was recorded (action, invoice number, current status or "cancellation pending a
  refund payout") and tells staff **not** to submit another cancellation.
- Staff procedure when a cancellation response is lost: reload the invoice. If
  it shows *cancelled* or a pending refund, the request succeeded. If unsure, an
  Admin can call `finance_request_outcome(<request id>)` to read the stored
  outcome (the reconciliation message in the UI already includes it; the id is
  also in `audit_events.details->>'request_id'` for the invoice). Only submit a new
  cancellation when the invoice is still *issued* with no pending refund and no
  outcome is recorded for the request id.

## Invoice e-mail recovery

- Provider outcome unknown (network/timeout/5xx): request state `uncertain`;
  "Retry send" reuses the same idempotency key within Resend's 24-hour window, so
  the customer cannot receive a duplicate.
- Provider accepted but history could not be saved: the action reports the
  request id and says not to resend. "Retry send" reuses the key; Resend
  returns the same message id and the acceptance is then recorded
  (`already_recorded` if it already was).
- Key window expired (> 24 h) with no acceptance: only "Send again (new e-mail)"
  is offered — an intentional resend with a new key.
- Provider acceptance is recorded as *accepted*, never as *delivered*.

## Verification performed

`scripts/verify-migration-upgrade.sh` resets the local stack to the reviewed
baseline, seeds invoices, payments, legacy cancellation requests and e-mail
history, applies the migration with `supabase migration up`, then verifies data
integrity, legacy replay, and old-build RPC compatibility. See the PR description
for the gate results.
