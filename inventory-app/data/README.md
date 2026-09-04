# Opening stock data

`opening-stock-2026-09-04.csv` is the initial tyre stock list supplied for the 24/7 Truck Tyre Services inventory system.

Source totals:

- 53 product lines
- 725 tyres
- Source fields supplied: Brand, Pattern, Size, Quantity

Fields intentionally left blank because they were not present in the source document:

- Condition (`New` / `Used`)
- Location (`Lonsdale` / `Regency Park`)
- Cost Price
- Selling Price
- Minimum Stock
- Reorder Quantity
- Supplier

## Import safety

Do **not** post these quantities directly to `inventory_balances` until the missing operational fields are confirmed.

The inventory ledger requires every inbound stock movement to have:

1. a valid location;
2. a valid product/tyre condition;
3. a non-negative inbound unit cost for Weighted Average Cost (WAC).

The opening-stock import workflow must therefore:

1. Parse and preview all rows before writing.
2. Match or create the product by normalised Brand + Pattern + Size + Condition.
3. Require Location and Condition for every row.
4. Require inbound unit cost before quantity is posted.
5. Allow optional Selling Price, Minimum Stock, Reorder Quantity and Supplier.
6. Reject duplicate/ambiguous rows rather than silently merging them.
7. Use the existing `create_product` and `post_inventory_movement` RPC paths so permissions, WAC, no-negative-stock checks and audit logging remain intact.
8. Use a stable per-row idempotency key so retrying an import cannot double the stock.
9. Present a final summary showing Created Products, Matched Products, Stock Posted, Skipped Rows and Errors.

Until those missing fields are completed, this CSV is the source-of-truth staging file only and must not alter live stock balances.
