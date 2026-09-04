# Opening stock data

`opening-stock-2026-09-04.csv` is the initial tyre stock list supplied for the 24/7 Truck Tyre Services inventory system.

Source totals:

- 53 product lines
- 725 tyres
- Source fields supplied: Brand, Pattern, Size, Quantity

Confirmed opening-stock details:

- Condition: `New` for every row.
- Location: `Regency Park` for every row.

Fields intentionally left blank for now:

- Cost Price
- Selling Price
- Minimum Stock
- Reorder Quantity
- Supplier

## Import safety

Do **not** post these quantities directly to `inventory_balances` while Cost Price remains blank.

The inventory ledger requires every inbound stock movement to have a non-negative inbound unit cost for Weighted Average Cost (WAC). The product catalogue also currently requires a numeric GST-inclusive selling price when a product is created, so the import workflow must treat these rows as staged inventory until the pricing fields are supplied or the catalogue workflow is explicitly changed to support price-pending products.

The opening-stock import workflow must therefore:

1. Parse and preview all rows before writing.
2. Treat every row as `New` stock at `Regency Park`.
3. Match or create the product by normalised Brand + Pattern + Size + Condition.
4. Keep Cost Price and Selling Price blank in the staging dataset until confirmed.
5. Do not infer or substitute `$0` for an unknown price.
6. Require inbound unit cost before quantity is posted to the live stock ledger.
7. Allow Minimum Stock, Reorder Quantity and Supplier to remain optional.
8. Reject duplicate/ambiguous rows rather than silently merging them.
9. Use the existing `create_product` and `post_inventory_movement` RPC paths so permissions, WAC, no-negative-stock checks and audit logging remain intact.
10. Use a stable per-row idempotency key so retrying an import cannot double the stock.
11. Present a final summary showing Created Products, Matched Products, Stock Posted, Skipped Rows and Errors.

Current staging status: **53 lines / 725 new tyres assigned to Regency Park, prices pending**.
