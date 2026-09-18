# Inventory deep review — 2026-09-18

## Scope and source snapshot

Reviewed the authoritative nested application at `C:\Users\abuba\247truck\inventory-app` on branch `main`. This record is a static/code-trace review; it is not production or deployment evidence.

The review covered `lib/auth`, `lib/inventory`, `lib/products`, `lib/opening-stock`, `lib/purchasing`, `lib/transfers`, the inventory/stock/purchasing/transfer server actions, and the current defining migrations. The critical source hashes at review time are recorded below so later changes can be distinguished from the reviewed state:

| Area | SHA-256 |
| --- | --- |
| `lib/auth/access.ts` | `BAD39834CB78D06B46B65E15457008005B0020B05C3922246944E2DE1E48C02C` |
| `lib/inventory/repository.ts` | `72DF4EBECF92B8DC81D567F146B1B5DB4940A5A9090ED76A69375B7AEC32BEF8` |
| `lib/inventory/queries.ts` | `D56353346592275175ACCE32D9178CA825A6E1B367F6CC23274F4CDD0A8AC244` |
| `lib/purchasing/queries.ts` | `0BA44029002A8BABF59CF124F33A65978E79B4849F1AC91EBF598491F9C90B05` |
| `app/(protected)/stock/actions.ts` | `B81944095116D54FCB6A0E59F3F1E72758572F771DBAE33A94E700A58111E879` |
| `app/(protected)/purchasing/purchase-orders/actions.ts` | `ED1A6882E1698D5BE1D9653900F013F809A098FE0D0E32EE096EF8F0E7A6353C` |
| `app/(protected)/transfers/actions.ts` | `59A4BF5876E44B376167B235DBFCC5DEC362B3A60E261E3ADEAF2E85488D4987` |
| `20260912131000_transfer_replay_hardening.sql` | `C53991D56B075B77CE32EC3132327C8B1E6728473A9848307F595D2DE5B53E67` |
| `20260914184110_used_tyre_intake_lock_hardening.sql` | `12515EE968493055D5774FD01D52F718DD861372EFC66CC274B35C87C44F1112` |
| `20260912130000_invoice_credit_revision_lock.sql` | `5E288ED23AF00C598BF3CD48BFCD3418EA88A6A492ED983637063AFEC141B311` |

## Confirmed controls

- `getCurrentAccess` derives the actor from `auth.getUser()`, requires an active profile, and rejects unknown roles and invalid branch assignment. `hasPermission` gives Admins access and only honours the constrained manager permission set.
- Product, opening-stock, stock, purchasing, transfer, and invoice mutation authority is held in security-definer RPCs. Server actions validate input and repeat the relevant application permission checks; the RPCs re-authorize against the session before a write.
- `post_inventory_movement_with_notes` serializes same-actor/location/request replays, verifies the full movement fingerprint before replay, and clears its transaction-local note GUC. `post_inventory_movement` locks the balance row and prevents both negative on-hand and on-hand below reserved.
- `create_used_tyre_unit_with_stock` holds the same replay advisory lock before creating the unit and has a one-used-unit-per-inbound-movement index. The concurrent duplicate-request regression is in `tests/integration/used-tyre-intake.test.ts`.
- Purchase receipt posting is restricted to `receive_purchase_order`; the public generic movement RPC rejects `purchase_receipt`. The receipt RPC locks the purchase order and selected lines in stable order, validates membership/outstanding quantities, posts ledger rows and status changes in one transaction, and uses the actor/location/request idempotency key.
- Transfer dispatch and receipt lock the transfer plus relevant balance rows in product order. The current replay hardening binds a replay to actor, action, transfer and canonical receipt input. A transfer cannot over-receive; shortages move it to `review_required` without inventing compensating stock.
- Opening-stock import is admin-only, row-idempotent, reconciles all source quantity, and preserves unknown cost as `NULL`; assignment is a separate immutable record and rebuilds WAC from ledger history.
- Invoice revision, invoice-line, finance-action-request, cost, credit-note, refund, and payment-reversal guards preserve immutable financial history. Credit creation locks later revision/current-revision changes; the direct-write guards enforce the same invariant. `tests/integration/review-invoice-credit-revision-lock.test.ts` covers both RPC and direct database write paths. Invoice 10602 is retained as the cross-layer GST fixture in `tests/integration/invoice-module-extensions.test.ts`.

## Confirmed application defect

The reviewed baseline of `app/(protected)/transfers/actions.ts` invoked several transfer RPCs and discarded their errors. The form wrappers for create and receive also discarded returned error state. Therefore a transition rejected by the database could be presented as a completed form submission without telling the operator why the transfer did not change. This does not bypass authorization: `submit_transfer_request`, `approve_transfer`, `dispatch_transfer`, `receive_transfer`, and the administrative transition RPCs each enforce authorization and state in SQL.

The action layer now provides state-compatible lifecycle actions that return `TransferActionResult`, and legacy create/receive wrappers throw on a returned failure. The UI review workstream owns replacing page forms with those state actions and surfacing their errors. It needs a focused regression that proves a rejected RPC leaves the user on an error state and does not display transition success.

## No new migration from this review

No unmitigated stock-atomicity, authorization, purchase-receipt, transfer-replay, or immutable-invoice defect was proven in the current SQL definitions. The existing migrations are additive and must remain immutable. Any later database repair must be a new forward migration, with a disposable-local reset and focused integration regression before it is considered ready.

## Pending verification

- Re-run the owned focused integration files only after the shared `reset → integration → E2E` sequence completes; do not seed or mutate the local fixture database during that run.
- Execute the transfer error-surfacing regression after the UI workstream completes.
- Review any changes to the listed source hashes before relying on this result.
- This review does not cover Adelaide API/mapping behaviour, location/listing/customer/admin actions, deployment configuration, production database state, or live integrations.
