# Production migration plan: customer-return replay identity

Target migration: `20260916155821_harden_customer_return_replay_identity`.

## Scope and ordering

- It follows `20260916151000_customer_returns_and_catalog_search` and only replaces the customer-return replay guard in `public.post_inventory_movement_with_notes`.
- It must be applied after every migration currently present in production and before the new generic-sales migration. Do not reorder, edit, or squash historical migration files.
- It contains no table drops, data deletes, backfills, or destructive DDL.

## Release prerequisites

1. Take and verify the approved production logical backup.
2. Confirm the linked project is `afefdlvepdbtaxoscwew` and that production history ends at `20260916151000`.
3. Apply the exact immutable release commit in a staging/production-like upgrade path, then run the targeted customer-return replay regression.
4. Verify the deployed function signature and grants: authenticated may execute the public customer-return RPC; no public/anon/service-role grant is added.
5. Use non-mutating production smoke checks only. Run actual return/replay tests on the disposable local database; do not create production movements as a smoke test.

## Expected behavior

- Replaying the same customer return without a supplied cost returns the existing movement rather than inserting another.
- Reusing that request identity with a different explicit cost, product, movement type, or other compared input fails with `IDEMPOTENCY_KEY_REUSED`. Location forms part of the request identity, rather than a globally unique key.
- A null customer-return cost means use the stored derived cost on replay. The ledger does not retain whether the original cost was explicit or derived, so explicit-to-null replay is not distinguished.
- Existing ledger history remains append-only.

## Rollback

The safe rollback is a new forward migration restoring the prior function body from the reviewed release commit. Do not delete the applied migration or mutate finance/inventory history.
