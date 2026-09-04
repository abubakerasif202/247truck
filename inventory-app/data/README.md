# Opening stock data

`opening-stock-2026-09-04.csv` is the confirmed initial tyre stock list for the 24/7 Truck Tyre Services inventory system.

Source totals:

- **53 product lines**
- **725 tyres**
- Condition: **New** for every row
- Location: **Regency Park** for every row
- Source identity fields: Brand, Pattern, Size, Quantity

Fields intentionally left unknown for now:

- Cost Price
- Selling Price

Optional operational fields may also remain blank until configured:

- Minimum Stock
- Reorder Quantity
- Supplier

## Approved live-import model

Unknown financial values are represented as `NULL`, never as `$0`.

This confirmed opening balance may be posted live through the dedicated Admin-only opening-stock path while Cost Price and Selling Price remain pending. This is a specific opening-balance exception; ordinary Quick Stock-In and purchase-order receiving still require a known non-negative inbound cost.

The authoritative workflow is:

1. Load only the committed `opening-stock-2026-09-04.csv` source on the server.
2. Validate the exact CSV structure and fingerprint it with SHA-256.
3. Require exactly **53 product lines / 725 tyres** before any live import is allowed.
4. Require every row to be `New`, `Truck Tyre`, and `Regency Park` (`REG`).
5. Require Cost Price and Selling Price to remain blank in this source; do not infer or substitute `$0`.
6. Build a deterministic normalized identity from Brand + Pattern + Size + Condition.
7. Preview each row as Create, Match, or Ambiguous. Ambiguous product identities block the live action.
8. Post each source row through `public.import_opening_stock_row`, which matches or creates exactly one product and then calls the dedicated `public.post_opening_stock` ledger path.
9. Never write directly to `inventory_balances`.
10. Record one immutable import-evidence row per dataset/row identity and use deterministic request IDs so retries cannot double stock.
11. Keep imported Selling Price as `NULL` until an authorized user explicitly assigns it.
12. Keep imported opening cost/WAC as `NULL` until Admin explicitly assigns the confirmed opening cost.
13. When opening cost is later assigned, preserve the original opening movement and reconstruct current WAC from chronological movement history.
14. Report known inventory value separately from positive-on-hand `Unvalued stock`.

## Admin workflow

`Inventory → Opening Stock Import → Preview → Make 725 tyres live`

The Make Live action is permitted only when the server-side source still reconciles to exactly 53 rows / 725 units and the product preview has no ambiguous identities.

## Financial pending states

- `NULL` Selling Price → `Price Pending` / `—`
- numeric Selling Price `0` → a real `$0.00`, not pending
- positive stock + `NULL` WAC → `Cost Pending`
- known inventory value excludes unresolved-cost units
- unresolved quantity is shown separately as `Unvalued stock`

Normal Quick Stock-In and PO receiving are unchanged: they still require a known cost.

Current source status: **53 lines / 725 New tyres confirmed for Regency Park, Cost Pending, Selling Price Pending**.
