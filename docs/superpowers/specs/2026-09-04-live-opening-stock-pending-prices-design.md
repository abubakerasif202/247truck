# Live Opening Stock with Pending Prices — Design Specification

**Date:** 2026-09-04

**Status:** Design approved in chat; written specification pending final user review

**Product:** 24/7 Truck Tyre Services Inventory Platform

**Scope:** Make the client-supplied 53-line / 725-tyre opening stock list live in the software at Regency Park while allowing cost and selling prices to remain genuinely unknown until the client supplies them later.

---

## 1. Objective

The opening stock list must become operational inventory immediately instead of remaining only as a staged CSV.

Confirmed business data:

- 53 product lines.
- 725 total tyres.
- Every row is `New` stock.
- Every row belongs to `Regency Park`.
- Cost Price is unknown for now.
- Selling Price is unknown for now.

The system must display and operate on the confirmed stock quantities without inventing financial values.

---

## 2. Core Principle

Unknown price is not zero price.

The application must never convert an unknown Cost Price or Selling Price into `$0.00` merely to satisfy database constraints. Doing so would corrupt stock valuation, gross-profit reporting, margin calculations and later historical interpretation.

The data model will therefore support explicit financial-pending states.

---

## 3. Product Pricing Model

`products.selling_price_incl_gst` will become nullable.

Meaning:

- `NULL` = selling price not yet supplied.
- `0.00` = an explicitly entered zero selling price, which remains a different business value.

Product creation and editing must allow a blank selling price.

The UI must display a blank/null price as `—` and show a visible `Price Pending` state rather than formatting it as `$0.00`.

Normal POS, quote and invoice flows introduced in later phases must not permit an item with a missing selling price to be sold automatically without an explicit price being entered for that transaction or assigned to the product first.

---

## 4. Inventory Cost Model

The current `inventory_balances.weighted_average_cost` field uses a numeric zero default and inbound stock normally requires a numeric cost. This must change for opening stock whose cost is genuinely unknown.

`inventory_balances.weighted_average_cost` will become nullable.

Meaning:

- `NULL` = cost basis not yet known.
- numeric value, including `0.0000`, = known cost basis.

A balance can therefore have positive on-hand stock while its WAC is `NULL`.

The inventory ledger remains authoritative for quantity history.

---

## 5. Opening Stock Movement

A dedicated opening-stock posting path will be introduced instead of abusing ordinary supplier Stock In.

Recommended movement type:

`opening_stock`

Rules:

- quantity must be positive;
- location must be valid;
- Admin-only posting;
- inbound unit cost may be `NULL` only for `opening_stock`;
- ordinary `quick_stock_in`, goods receiving and future purchasing flows continue to require a known inbound unit cost unless separately changed by an approved design;
- every opening-stock movement creates an immutable inventory movement and an audit event;
- stock must never be written directly into `inventory_balances`;
- stable idempotency keys prevent a retry from adding the same opening quantity twice.

The 53-row source CSV will be posted through this dedicated path.

---

## 6. WAC Behaviour While Cost Is Pending

For any product/location balance with positive stock and unknown WAC:

- valuation is unknown;
- COGS is unknown until a cost basis is assigned;
- gross profit and margin must not be calculated from a fake zero cost.

The UI and reports must show `Pending` / `—` where valuation or cost-based metrics cannot be trusted.

If additional stock with known cost is received before the opening cost is supplied, the system must not silently calculate WAC using only the new receipt and ignore the unknown-cost stock. The balance remains financially incomplete until the unknown opening cost is resolved.

---

## 7. Assigning Opening Cost Later

Admin will have an audited `Assign Opening Cost` action for price-pending opening stock.

The action accepts a per-unit opening cost for a specific product/location opening-stock quantity.

Requirements:

- Admin-only.
- Cannot silently overwrite a previously confirmed opening cost.
- Writes an immutable audit event with old state, new cost, user, product, branch and time.
- Recalculates the location WAC using the confirmed cost and any subsequent known-cost inbound stock according to chronological inventory cost events.
- Does not modify historical quantity movements.

If a full historical WAC reconstruction is required because later receipts have already occurred, the database must recompute from the cost-bearing movement history rather than performing a naive one-line update to the current balance.

---

## 8. Selling Price Assignment Later

Admin may assign the global GST-inclusive selling price at any time through the existing product edit workflow after it is updated to accept nullable prices.

A price change from `NULL` to a numeric value must be audited.

The application must visually distinguish:

- `Price Pending`
- a confirmed numeric selling price

No location-specific selling-price override is introduced by this change.

---

## 9. Opening Stock Import Workflow

An Admin-only opening-stock import workflow will load the existing repository dataset:

`inventory-app/data/opening-stock-2026-09-04.csv`

The import flow will:

1. Parse and validate the full file before posting.
2. Treat all rows as New tyres at Regency Park based on the confirmed source data.
3. Normalise Brand, Pattern and Size using existing product catalogue rules.
4. Match existing products where the match is unambiguous.
5. Create missing products with nullable selling price.
6. Post each confirmed quantity as an `opening_stock` movement with nullable cost.
7. Use deterministic per-row idempotency keys.
8. Refuse ambiguous duplicate product matches.
9. Produce a final import report with Created Products, Matched Products, Quantities Posted, Skipped Rows and Errors.
10. Never substitute `$0` for missing cost or selling price.

The expected successful quantity total is exactly 725 tyres across 53 source rows.

---

## 10. User Interface

### Inventory list

Regency Park inventory will immediately show the imported products and live quantities.

Each row may display:

- Brand
- Pattern
- Size
- New
- Regency Park on-hand quantity
- Selling Price: `—` when null
- Cost/WAC: `—` when null and user has permission to view cost
- Status badges such as `Price Pending` and `Cost Pending`

### Product detail

A product with unknown financial values shows clear warning cards:

- `Selling price pending`
- `Opening cost pending`

Admin gets actions to assign the missing values later.

Managers continue to see only data permitted by their role and branch scope.

---

## 11. Reporting Behaviour

Quantitative inventory reports may include the stock units immediately.

Financial reports must not treat unknown-cost stock as zero-value stock.

Required behaviour:

- quantity totals include the 725 tyres;
- inventory valuation excludes unresolved cost from the numeric valuation total or reports it separately;
- show a clear `Unvalued stock` count/quantity;
- gross-profit and margin reports must mark affected transactions/products as incomplete where cost basis is unresolved;
- dashboards must never imply that unresolved inventory has zero acquisition cost.

Recommended summary example:

- Known inventory value: `$X`
- Unvalued stock: `725 units` initially

---

## 12. Security and Audit

The following are Admin-only:

- running the opening-stock import;
- assigning opening cost;
- assigning or changing global product selling prices unless the existing permission model explicitly grants price editing to a Manager.

All opening-stock postings and later financial assignments must create audit events.

Branch RLS remains unchanged: Regency Park Managers may see their branch stock but cannot gain access to Lonsdale data.

---

## 13. Data Integrity

Database invariants after this change:

- on-hand quantity cannot be negative;
- opening-stock movement quantity must be positive;
- opening-stock cost may be NULL;
- ordinary inbound flows still require known cost;
- selling price may be NULL;
- NULL cost/price is never automatically converted to zero;
- inventory movements remain append-only;
- imported opening-stock rows are idempotent;
- cost assignment cannot mutate the original quantity movement;
- financial reports distinguish unresolved cost from zero cost.

---

## 14. Migration Compatibility

This feature must preserve existing Phase 1 behaviour for normal priced/costed products.

Required migration work includes:

- make `products.selling_price_incl_gst` nullable;
- make `inventory_balances.weighted_average_cost` nullable;
- adjust product RPCs and validation to accept missing selling price;
- add `opening_stock` movement type and posting RPC or extend the existing atomic posting RPC safely;
- adjust summary views/RPCs for nullable WAC;
- add audited opening-cost assignment/reconstruction logic;
- adjust formatting/types/UI for nullable financial fields.

Existing security-definer functions must continue to use a locked search path and explicit grants.

---

## 15. Testing Requirements

Automated tests must cover at minimum:

- product creation succeeds with blank selling price;
- blank selling price remains NULL, not zero;
- opening stock posts positive quantity with NULL cost;
- opening stock cannot be posted by an unauthorized Manager;
- normal Quick Stock In still rejects missing inbound cost;
- duplicate opening-stock import retry is idempotent;
- all 53 source rows produce exactly 725 live Regency Park units in a disposable test database;
- Lonsdale remains unchanged by this import;
- inventory list displays quantity while showing pending financial fields;
- valuation does not count NULL-cost stock as zero-value stock;
- later opening-cost assignment creates audit history and resolves WAC correctly;
- later selling-price assignment creates audit history;
- no-negative-stock and existing concurrency tests remain green;
- existing branch RLS tests remain green.

---

## 16. Rollout

Implementation is first verified against the local/disposable Supabase project.

Production rollout order:

1. Apply schema migration.
2. Deploy compatible application code.
3. Confirm Admin access and Regency Park location.
4. Dry-run the opening-stock import and verify 53 rows / 725 tyres.
5. Run the live import once.
6. Verify Regency Park quantities and Lonsdale unchanged.
7. Verify Price Pending / Cost Pending states.
8. Preserve the source CSV and import report as audit evidence.

No existing production stock should be deleted or reset as part of this rollout.

---

## 17. Acceptance Criteria

The change is complete when:

1. All 53 source tyre lines are visible as live products/stock in the software.
2. Regency Park shows exactly 725 opening tyres in total.
3. All imported tyres are marked New.
4. Lonsdale receives none of this opening stock.
5. Cost Price remains genuinely blank/unknown.
6. Selling Price remains genuinely blank/unknown.
7. The UI displays pending states rather than `$0`.
8. Stock quantities are operational and auditable.
9. The client can assign cost and selling prices later.
10. Financial reporting does not treat unknown cost as zero.
11. Existing stock security, branch isolation, concurrency and no-negative-stock protections continue to pass.
