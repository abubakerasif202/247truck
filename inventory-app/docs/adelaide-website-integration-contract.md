# Adelaide website inventory contract

This repository is the authoritative inventory ledger. The Adelaide website source is not present here, so its checkout transaction must be implemented and verified in that repository before release.

## Required website transaction

When payment is confirmed, the website must atomically update its order to `paid` and insert/update a durable inventory outbox record with the reservation ID, order reference, stable state request ID, payload hash, attempt count, next retry time and last error. It must not mark an order ready for fulfilment until this service reports `inventory_state=committed`.

The website worker sends `POST /api/integrations/adelaide/orders/state` **before** any commit attempt, on every attempt, under a stable request ID derived from its durable commit request ID:

```json
{
  "reservationId": "uuid",
  "orderReference": "stable external order reference",
  "paymentStatus": "paid",
  "orderStatus": "confirmed",
  "commitRequestId": "the website's durable commit request id (uuid)"
}
```

This call is what protects the hold: only `register_adelaide_order_state` sets `paid_protected_at`, and only a paid record stops `expire_adelaide_inventory_reservations` and the commit RPC from expiring a hold whose checkout window has passed. The response echoes the commit identity this service will honour as `commit_request_id` — normally the supplied `commitRequestId`, otherwise the identity already recorded for the order or the one under which the sale was already committed. The website then sends `POST /api/integrations/adelaide/sales/commit` using that `commit_request_id` as its request ID.

### One commit identity per sale

Both this service's paid-commit retry queue (`process_adelaide_commit_queue`) and the website's direct commit use the same request ID and the same canonical identity hash, `sha256(lower(reservationId) + "
" + orderReference)` (`commitIdempotencyHash` in `lib/integrations/adelaide-auth.ts`, `private.adelaide_commit_identity_hash` in SQL). Whichever side commits first, the other's call is a no-op replay that returns `committed`; a different identity for an already-committed sale is refused with `409 IDEMPOTENCY_KEY_REUSED`. A direct commit also settles the durable paid record, so health and reconciliation never report a committed sale as awaiting commit.

Every integration request uses these headers:

- `x-awt-client-id`: configured client ID.
- `x-awt-timestamp`: Unix epoch milliseconds, within five minutes.
- `x-awt-request-id`: stable UUID for the logical operation.
- `x-awt-signature`: lowercase hex HMAC-SHA256.

The signed bytes are `METHOD + "\n" + PATHNAME + "\n" + TIMESTAMP + "\n" + REQUEST_ID + "\n" + SHA256(RAW_BODY)`. A true retry must reuse the same request ID and byte-equivalent semantic payload. A changed payload requires a new logical operation and request ID. The maximum body is 32 KiB and reservation/availability requests accept at most 25 lines.

The website worker retries network errors, `429`, and `5xx` with bounded exponential backoff. For an uncertain commit response it first queries the signed reservation status endpoint and reuses the original commit request ID. `409 IDEMPOTENCY_KEY_REUSED` is a manual-review event, never a reason to generate a new key for the same operation.

## Lifecycle

`reservation_pending -> reserved -> payment_pending -> commit_pending -> committed` is the successful path. Cancellation before payment uses `release_pending -> released`. Paid reservations cannot be released or expired. Eight failed inventory commit attempts move the inventory-side durable record to `manual_review`; an Admin can requeue it from Inventory Reconciliation.

The website must not infer stock from cached UI data. `409 INSUFFICIENT_STOCK` and reservation conflicts require refreshing the affected mapping through availability while preserving the shopper/staff form input.

## Endpoints

- `POST /api/integrations/adelaide/availability`
- `POST /api/integrations/adelaide/reservations`
- `POST /api/integrations/adelaide/reservations/{reservationId}` (status)
- `DELETE /api/integrations/adelaide/reservations/{reservationId}`
- `POST /api/integrations/adelaide/orders/state` (durable paid-state handoff; always first)
- `POST /api/integrations/adelaide/sales/commit` (direct commit under the identity returned by the handoff)

All errors are allow-listed codes; internal SQL and credentials are never returned. Correlation is the `x-request-id` response header.

## Product catalogue handoff

The website release must export every active sellable tyre with stable website ID, brand, pattern, size, condition and intended branch. That manifest must exactly match `adelaide_website_products`. Missing, duplicate, inactive, wrong-attribute or wrong-branch mappings block deployment. Runtime fuzzy matching is forbidden.

## Cross-system acceptance test

Use one controlled test order: check signed availability; reserve; mark payment confirmed and outbox state transactionally on the website; deliver the state request; run the retry processor; confirm one and only one stock movement; confirm the website remains unfulfillable until `committed`; retry every delivery with the same identities; then run reconciliation and require zero unexplained critical rows.

Locally this is `tests/integration/adelaide-integration-routes-db.test.ts` (real signed requests through the real route handlers into the local database, including a hold past its window that survives expiry because it is paid) and, on the website, `tests/unit/inventory-client.test.mjs` (handoff-then-commit ordering and identity) plus `tests/cross-system/*`.
