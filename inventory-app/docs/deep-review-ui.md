# Deep UI Review — 2026-09-18

## Scope and evidence

Reviewed the complete current contents of the following UI source files and their focused tests. SHA-256 values are recorded after the review edits.

| File | SHA-256 | Review result |
| --- | --- | --- |
| `components/finance/manual-invoice-form.tsx` | `B4A9B8ECBD1EBE971356B930C2BB8F30B1AB8E260F9C23E65F1FEDD1FCC7A501` | Corrected terms state, keyboard lookup, and stale vehicle result handling. |
| `components/ui/pending-submit-button.tsx` | `0A62E2EF1ADA74EF8E0C73E35A2D0D10392F3AE3092567C43BA659CA111E4759` | Correctly locks submit controls while a server action is pending. |
| `components/shell/app-shell.tsx` | `C642ED15DA82B86E3A0517D1018A061357FC3CCA590C93239B63350CBBEBA3A8` | Skip link targets the application main landmark and preserves shell layout. |
| `app/(protected)/jobs/[id]/page.tsx` | `B92F25D2F8785E805C69FA0448A1EC0BD28680B659341C576440EA21438598F1` | Lifecycle submit controls use pending-state locking. |
| `app/(protected)/quotes/[id]/page.tsx` | `78DD6F2162086F625850E742CB365FD919672922A3DC8E2394651EDB8383079A` | Lifecycle submit controls use pending-state locking. |
| `app/(protected)/transfers/[id]/page.tsx` | recorded after transfer error-state wiring | Replaced silent direct form actions with stateful error-reporting controls. |
| `app/(protected)/transfers/[id]/receive/page.tsx` | recorded after transfer error-state wiring | Receipts now retain actionable server errors. |
| `components/transfers/transfer-lifecycle-controls.tsx` | recorded after transfer error-state wiring | Added stateful lifecycle and receipt forms with pending locking and live errors. |
| `tests/unit/manual-invoice-form.test.tsx` | `5054D9A041B93D7370C4E78AD0A2DBEAB1242088F28018EEAB9C83A09B64E6FB` | Added customer-term, keyboard-selection, and stale-vehicle regression coverage. |
| `tests/unit/pending-submit-button.test.tsx` | `B9138DF4B3C8193AFC2A0A1968C982838C69F5B9B6C5A873DB248ED874ABCA66` | Covers normal and pending states. |

Read `AGENTS.md`, `UX-CONTRACT.md`, `DESIGN.md`, and Next 16's local forms guide before editing. The review also inspected the full shell navigation, customer forms, sales draft form, invoice edit/action forms, finance panels, transfer action code, and opening-stock panel/test to trace form and server-action behaviour.

## Confirmed findings and resolutions

1. Manual invoice payment terms previously used an uncontrolled default. Selecting a customer after first paint could retain a prior customer's terms. The select is now controlled, adopts the selected customer's terms, and returns to the manual default when the selection is cleared.
2. Manual invoice vehicle responses could arrive after the customer had been cleared and re-populate the empty selection. A monotonic request sequence now rejects stale responses.
3. The manual invoice customer list lacked keyboard selection. The combobox now exposes an active option and supports Arrow Up, Arrow Down, Enter, and Escape.
4. Transfer lifecycle and receipt forms could silently discard an action failure. The page forms now use action state, keep an error in a `role="alert"`, and disable the active submit during the request.
5. The stock-import test reported by the full-suite run passes in isolation; its test already awaits the state transition. No UI test change was warranted.

## Cross-owner blocker reported

`app/api/sales/customers/route.ts` and `app/api/sales/vehicles/route.ts` omit invoice permissions from their read authorization. A role that can create/view invoices but has no quotes, jobs, or POS permission receives a 403 when using manual invoice customer search. This API authorization fix was reported to the root owner; it is outside this UI file ownership.

## Validation

- `npx vitest run tests/unit/manual-invoice-form.test.tsx tests/unit/pending-submit-button.test.tsx --reporter=verbose`: 5 passed, 0 failed, 0 skipped.
- `npx vitest run tests/unit/opening-stock-import-panel.test.tsx --reporter=verbose`: 3 passed, 0 failed, 0 skipped.
- `npx tsc --noEmit`: initially identified two existing/new UI-test mock typing issues; both were corrected. Final typecheck is pending the root's combined validation run.

## Not independently browser-reviewed in this pass

No live browser or mobile-device session was run. The full protected route set, CSS visual polish, dialog/sheet focus traps, and every form component were source-inspected selectively rather than exhaustively interaction-tested. No deployment, push, or production mutation was performed.
