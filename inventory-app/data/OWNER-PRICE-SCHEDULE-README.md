# Owner price schedule

`owner-price-schedule-2026-09-08.csv` is the owner-supplied commercial reference for 28 truck-tyre identities. Prices are AUD GST-inclusive selling prices. They are not purchase costs, WAC values, stock adjustments, or production instructions.

The `source_quantity_text` column preserves the supplied notation. In particular, the Greforce GRT33 9.5R17.5 row preserves `09`; `quantity` is the numeric value `9`.

The companion reconciliation file is deliberately uncommitted to product IDs, SKUs, current prices, costs, WAC, or stock balances until the local Supabase catalogue and ledger are available. The committed opening-stock source confirms these 28 identities and reference quantities as source rows, but that is not proof of the current database product identity or physical balance.

Before applying any price, resolve one existing product by exact brand, pattern, size, condition, and category. Use `set_product_selling_price` through the Admin pricing workflow. Do not create a product, post a movement, change WAC, replay opening stock, or alter historical invoice snapshots as part of this schedule.
