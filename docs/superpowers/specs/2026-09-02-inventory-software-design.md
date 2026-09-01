# 24/7 Truck Tyre Services Inventory Software — Design Specification

**Date:** 2026-09-02  
**Status:** Approved design, pending user review of this written specification  
**Business:** 24/7 Truck Tyre Services  
**Locations:** Lonsdale and Regency Park  
**Product form:** Standalone internal inventory/POS application with responsive PC and mobile UI

## 1. Purpose

Build a standalone operational platform for 24/7 Truck Tyre Services that manages stock, purchasing, inter-location transfers, customers, workshop/roadside jobs, POS sales, invoices, payments, receivables, reporting, and audit history across two locations.

The application is separate from the public marketing website. It will be installable as a PWA on Windows, Android, iPhone, and tablets while remaining online-only in v1.

The design prioritises:

- Fast workshop use on phone and desktop.
- Accurate stock quantities and valuation.
- Strong location isolation for managers.
- Clear Admin approval controls.
- Complete auditability for stock and financial actions.
- A modular architecture that can later support more locations or native apps without redesigning the core data model.

## 2. Existing Project Alignment

The current 24/7 Truck Tyre Services codebase already uses Next.js, React, TypeScript, Tailwind, Vercel-oriented deployment, Resend, and Supabase-backed business data. The inventory application should align with that technical direction while remaining a separate internal application/deployment.

Recommended baseline:

- Node.js 22.x.
- Next.js 16.
- React 19.
- TypeScript 5.
- Tailwind CSS 4.
- shadcn/ui for application components.
- Supabase PostgreSQL, Auth, and Storage.
- Stripe for online invoice payments.
- Resend for transactional email.
- Vercel for hosting.

## 3. Roles and Access Model

### 3.1 Admin

Admin has full access to both locations and all system settings.

Admin capabilities include:

- View and manage Lonsdale and Regency Park.
- View combined and location-specific reports.
- Manage users and manager permissions.
- Manage global product pricing.
- View cost and profit information.
- Approve or reject purchase orders.
- Approve or reject stock-transfer requests.
- Resolve transfer discrepancies.
- Configure business, invoice, email, payment, and document settings.
- Review all audit logs.

### 3.2 Manager

Every manager is assigned to exactly one location.

- Lonsdale managers can access only Lonsdale operational data.
- Regency Park managers can access only Regency Park operational data.
- Location isolation must be enforced server-side and at the database layer, not only hidden in the UI.
- Managers use a custom permission matrix controlled by Admin.

Permission groups include:

**Sales**

- View/edit customers.
- Create quotes.
- Create jobs.
- Create invoices.
- Record payments.
- Apply discounts.
- Issue refunds.

**Inventory**

- View stock.
- Quick Stock-In.
- Stock-Out.
- Stock adjustment.
- Full stocktake.
- View cost.
- Edit selling price.

**Purchasing**

- Create purchase orders.
- Submit purchase orders.
- Receive purchase orders.
- Quick Stock-In.

**Transfers**

- Request transfer.
- Dispatch transfer.
- Receive transfer.

**Reports**

- View sales reports.
- View stock reports.
- View inventory value.
- View profit.
- Export reports.

Admin-only permissions by default:

- Approve purchase orders.
- Approve transfer requests.
- Manage users.
- Manage permission definitions.
- Manage business/system settings.
- Access both locations.

## 4. Authentication

v1 authentication is email and password.

Requirements:

- Supabase Auth-backed login.
- Password reset by email.
- Secure session management.
- Admin can disable manager accounts.
- Admin can revoke active sessions.
- Login activity is auditable.
- No 2FA requirement in v1; architecture must allow it later.

## 5. Locations

The system starts with exactly two locations:

1. **Lonsdale** — code `LON`.
2. **Regency Park** — code `REG`.

Admin sees a persistent location scope selector:

- All Locations.
- Lonsdale.
- Regency Park.

Managers never receive an All Locations mode and cannot switch branches.

## 6. Record Numbering

Operational records use separate location sequences.

### Lonsdale

- `LON-QUO-000001` — Quote.
- `LON-JOB-000001` — Job.
- `LON-INV-000001` — Invoice.
- `LON-PO-000001` — Purchase Order.
- `LON-TRF-000001` — Transfer.
- `LON-STK-000001` — Stocktake.
- `LON-GRN-000001` — Goods Receipt.

### Regency Park

- `REG-QUO-000001`.
- `REG-JOB-000001`.
- `REG-INV-000001`.
- `REG-PO-000001`.
- `REG-TRF-000001`.
- `REG-STK-000001`.
- `REG-GRN-000001`.

Sequences must be generated atomically in the database to prevent duplicates.

## 7. Application Shell

### 7.1 Desktop navigation

Desktop uses a left navigation rail and persistent top bar.

Primary navigation:

- Dashboard.
- Inventory.
- Stock.
- Transfers.
- POS / Sales.
- Jobs.
- Customers.
- Purchasing.
- Reports.
- Audit.
- Settings.

The top bar contains:

- Global search.
- Location scope for Admin.
- Notifications.
- User/account menu.

### 7.2 Mobile navigation

Mobile is purpose-designed rather than a shrunken desktop table.

Bottom navigation:

- Home.
- Stock.
- Jobs.
- Customers.
- More.

`More` includes:

- Quotes.
- Invoices.
- Payments.
- Purchase Orders.
- Transfers.
- Suppliers.
- Reports.
- Settings.

Prominent quick actions:

- Stock In.
- Stock Out.
- New Job.
- New Quote.
- New Invoice.
- Purchase Order.
- Transfer Request.

## 8. Dashboard

### 8.1 Admin dashboard

Admin dashboard includes:

- Total inventory value.
- Today’s sales.
- Outstanding invoices.
- Low-stock items.
- Stock in transit.
- Pending purchase-order approvals.
- Pending transfer approvals.
- Transfer discrepancies.
- Recent stock adjustments.

Location comparison includes:

- Stock value.
- Sales.
- Jobs.
- Low-stock count.
- Overdue invoices.

### 8.2 Manager dashboard

A manager sees only their location and relevant permissions.

Dashboard includes:

- Today’s sales.
- Jobs today.
- Low-stock warnings.
- Purchase orders awaiting Admin approval.
- Transfers awaiting action.
- Unpaid/overdue invoices.
- Recent stock movements.

## 9. Global Search

Global search must cover:

- Product name.
- Tyre size.
- Brand.
- Pattern.
- Part/reference number.
- Customer name.
- Company name.
- Mobile number.
- Email.
- Vehicle registration.
- Fleet number.
- ABN.
- Quote number.
- Job number.
- Invoice number.
- Purchase-order number.
- Transfer number.

Search results must show location-aware stock information and relevant linked records.

## 10. Product and Inventory Model

### 10.1 Supported categories

v1 manages tyres and related workshop stock:

- Truck tyres.
- Rims / wheels.
- Tubes.
- Valves.
- Wheel nuts / studs.
- Repair patches and repair materials.
- Balancing weights.
- Workshop consumables.
- Other related parts.

### 10.2 Product master

Each product has a master record.

Common fields:

- Product name.
- Category.
- Active/archived status.
- Part/reference number where applicable.
- Global GST-inclusive selling price.
- Preferred supplier.
- Notes.

Tyre-specific fields:

- Condition: New or Used.
- Brand.
- Pattern.
- Size.
- Load index.
- Speed rating.

Reusable tyre specifications such as size, brand, and pattern must use normalised searchable values to avoid duplicate variants caused by inconsistent typing.

### 10.3 No barcode or QR requirement

v1 contains no barcode or QR scanning workflow.

Inventory is managed through:

- Search.
- Filters.
- Product selection.
- Manual quantity controls.
- Internal system references.

## 11. New and Used Tyre Tracking

### 11.1 New tyres

New tyres are normally quantity-tracked.

For each location, expose:

- On hand.
- Reserved.
- Available.
- Minimum stock.
- Reorder quantity.
- Weighted-average cost.

`Available = On Hand - Reserved`.

### 11.2 Used tyres

Used tyres use hybrid tracking.

Grouped used stock is allowed when tyres are effectively equivalent.

Individual used tyres are allowed when condition differs materially.

Individual used tyre fields may include:

- Internal unit ID.
- Brand.
- Pattern.
- Size.
- Tread depth in millimetres.
- Condition.
- Cost.
- Selling price if an authorised override is required.
- Location.
- Notes.
- Photos.
- Status.

Allowed condition values:

- Excellent.
- Good.
- Fair.
- Scrap.

Allowed individual status values:

- Available.
- Reserved.
- Sold.
- Scrap.

The data model must allow a product to contain bulk quantity and individually tracked units while preserving one reliable stock ledger.

## 12. Inventory Ledger and Balances

Inventory quantities must not be arbitrary editable counters.

Every stock change creates an immutable inventory movement with:

- Product.
- Optional individual unit.
- Location.
- Quantity delta.
- Movement type.
- Source record type and ID.
- User.
- Timestamp.
- Notes/reason where required.
- Cost snapshot where relevant.

Movement types include:

- Purchase receipt.
- Quick Stock-In.
- Job consumption.
- POS/manual invoice sale.
- Stock-Out.
- Adjustment.
- Stocktake adjustment.
- Customer return.
- Supplier return.
- Transfer dispatch.
- Transfer receipt.

Current balance is maintained from validated movements and must remain reconcilable to the ledger.

## 13. Negative Stock Rule

Negative stock is never allowed.

Protection exists at three layers:

1. UI validation.
2. Server/API validation.
3. Database transaction validation.

Concurrent sales or movements must use database-level locking/atomic checks so two simultaneous operations cannot oversell stock.

## 14. Reservations

Quotes do not reserve stock by default.

An accepted quote converted to a job may reserve stock.

Rules:

- Reservation reduces available stock but not on-hand quantity.
- Completing the job converts reserved quantity to consumed quantity.
- Cancelling the job releases reservations.
- Reservations cannot exceed available quantity.

## 15. Weighted-Average Cost

Weighted Average Cost (WAC) is used for inventory valuation and COGS.

WAC is location-specific.

On inbound purchased stock:

`New WAC = ((Existing Qty × Existing WAC) + (Received Qty × Unit Cost)) / New Qty`

Rules:

- Sales do not recalculate WAC.
- Job/POS/invoice lines store their cost basis at consumption time.
- Historical gross-profit reports do not change when future purchase prices change.
- Managers see cost/profit only when their permissions allow it.

## 16. Stock In / Stock Out

### 16.1 Quick Stock-In

Fields:

- Product.
- Location.
- Quantity.
- Unit cost.
- Supplier.
- Supplier invoice/reference.
- Notes.

Saving Quick Stock-In:

- Creates an inventory movement.
- Updates location balance.
- Recalculates WAC.
- Creates audit history.

Quick Stock-In is permission-controlled because it bypasses PO approval.

### 16.2 Quick Stock-Out

Reasons include:

- Damaged stock.
- Write-off.
- Internal use.
- Missing stock.
- Data correction.
- Warranty return.
- Supplier return.
- Other adjustment.

Quantity cannot exceed available stock.

A reason is mandatory; notes may be mandatory for selected reason types.

## 17. Stock Adjustments

Managers can adjust stock at their assigned location if they have the permission.

Every adjustment records:

- Product.
- Location.
- Previous quantity.
- New quantity.
- Difference.
- Mandatory reason.
- Optional notes.
- User.
- Date/time.

Admin can report on all adjustments across both locations.

## 18. Full Stocktake

v1 supports a simple full-location stocktake only.

Workflow:

1. Start stocktake for one location.
2. Record physical counts for all active products.
3. Save progress.
4. Review variance report.
5. Confirm stocktake.
6. Create inventory adjustment movements for confirmed variances.

A completed stocktake preserves:

- System quantity at count time.
- Counted quantity.
- Difference.
- User.
- Timestamp.
- Resulting movement references.

## 19. Low Stock and Smart Reordering

Each product has separate location settings:

- Minimum stock threshold.
- Reorder quantity.
- Preferred supplier.

When current available stock falls below minimum, the product becomes Low Stock.

The low-stock screen can suggest:

- Purchase Order.
- Transfer from the other location when sufficient stock exists there.

Suggestions never automatically order or transfer inventory.

Admin/Manager can select suggested products and generate a draft PO, grouped by preferred supplier where possible.

## 20. Suppliers

Supplier records contain:

- Supplier name.
- ABN.
- Contact person.
- Phone.
- Email.
- Address.
- Payment terms.
- Account/reference number.
- Notes.
- Active/inactive status.

Product-supplier relationships may contain:

- Supplier SKU.
- Last purchase cost.
- Typical lead time.
- Minimum order quantity.
- Preferred supplier flag.

Supplier reporting includes spend, order history, and product cost history.

## 21. Purchase Orders

### 21.1 Approval model

Manager creates PO → Admin approves before supplier dispatch/email.

Statuses:

- Draft.
- Submitted for Approval.
- Approved.
- Sent to Supplier.
- Partially Received.
- Received.
- Closed.
- Rejected.
- Cancelled.

### 21.2 PO behaviour

Manager can:

- Select supplier.
- Select delivery location.
- Add product lines.
- Enter quantity and supplier unit cost.
- Add supplier reference.
- Add notes.
- Attach supplier quote/document.
- Submit for approval.

Admin can:

- Edit before approval.
- Approve.
- Reject with mandatory reason.
- Send approved PO to supplier.

All approval changes are audited.

## 22. Receiving Purchase Orders

Partial receiving is supported.

For each PO line track:

- Ordered quantity.
- Previously received quantity.
- Receive-now quantity.
- Outstanding quantity.

Every receipt creates a Goods Receipt record and inventory movements.

Receiving stock:

- Adds inventory to the PO location.
- Updates WAC using received supplier cost.
- Updates PO received quantities.
- Changes PO status atomically.
- Creates audit history.

Over-receiving above ordered quantity is blocked in v1.

## 23. Inter-Location Transfers

Transfer workflow:

`Requested → Approved → Dispatched → In Transit → Received → Completed`

Alternative states:

- Rejected.
- Cancelled.
- Review Required.

### 23.1 Request

A manager requests a transfer from their own location or for their own location as allowed by the UI flow.

Request contains:

- From location.
- To location.
- Product lines.
- Quantities.
- Reason.
- Requesting user.

Requested quantity cannot exceed available source stock.

### 23.2 Approval

Only Admin approves or rejects transfers in v1.

Approval alone does not move stock.

### 23.3 Dispatch

Sending location confirms dispatch.

Atomic dispatch action:

- Revalidates available stock.
- Deducts source on-hand inventory.
- Captures source WAC as transfer unit cost.
- Creates transfer-out movements.
- Marks transferred quantity In Transit.

### 23.4 Receipt

Receiving location confirms actual received quantity.

For fully matching receipt:

- Adds destination inventory.
- Recalculates destination WAC using transferred unit cost.
- Creates transfer-in movements.
- Completes transfer when all lines are received.

### 23.5 Transfer discrepancy

If received quantity differs from dispatched quantity:

- Do not silently complete.
- Require discrepancy note.
- Mark transfer Review Required.
- Matching received quantity may be booked to destination.
- Unresolved quantity remains represented as unresolved in-transit/discrepancy stock until Admin resolves it through an explicit disposition.

Admin resolution must produce auditable movements such as return-to-sender or approved write-off; no quantity may disappear without a movement.

## 24. Customers

### 24.1 Individual customers

Fields:

- Name.
- Mobile.
- Email.
- Address.
- Notes.
- Payment terms.

### 24.2 Business / fleet customers

Fields:

- Company name.
- ABN.
- Billing address.
- Primary contact.
- Phone.
- Email.
- Payment terms.
- Notes.

Business customers may have:

- Multiple contacts.
- Multiple trucks.
- Multiple trailers.
- Registration numbers.
- Fleet numbers.
- Customer PO/reference requirements.
- Complete quote/job/invoice/payment history.

No credit-limit feature in v1.

## 25. Customer Vehicles

Vehicle records may contain:

- Registration.
- Vehicle type.
- Make/model.
- Fleet number.
- Trailer registration where applicable.
- Notes.

Vehicle registration must be globally searchable.

## 26. Quotes

Statuses:

- Draft.
- Sent.
- Accepted.
- Declined.
- Expired.
- Cancelled.
- Converted to Job.

A quote may contain:

- Customer.
- Vehicle.
- Product lines.
- Free-text labour/service lines.
- Other charges.
- Discounts where authorised.
- Notes.
- GST-inclusive totals.

Quotes do not deduct stock.

Accepted quotes can convert to jobs without re-entering customer, product, labour, vehicle, pricing, or notes.

## 27. Jobs

Job statuses:

- New.
- Scheduled.
- In Progress.
- Waiting.
- Completed.
- Cancelled.

Job fields include:

- Customer.
- Contact.
- Vehicle registration.
- Fleet number.
- Customer PO/reference.
- Job description.
- Location.
- Manager.
- Date/time.
- Internal notes.
- Customer notes.
- Product lines.
- Free-text labour/service lines.
- Other charges.

Completing a job:

- Revalidates stock.
- Converts reservations to consumption.
- Captures inventory cost basis.
- Creates inventory movements.
- Marks job completed.
- Can create the linked invoice in the same transaction.

A job cancellation releases active reservations.

## 28. POS and Direct Sales

POS is available for transactions that do not need a full job.

Uses include:

- Counter tyre sale.
- Parts sale.
- Simple workshop transaction.

A built-in Walk-In Customer record avoids mandatory customer creation for simple sales.

POS flow:

1. Select/search customer or Walk-In Customer.
2. Add inventory products.
3. Add free-text labour/service lines if needed.
4. Review GST-inclusive total.
5. Finalise sale.
6. Consume inventory atomically.
7. Create invoice/receipt.
8. Record payment or leave invoice outstanding when permitted.

## 29. Labour and Service Pricing

v1 has no fixed service catalogue.

Labour/service lines are free text with:

- Description.
- Quantity/hours.
- GST-inclusive unit price.
- Optional internal note.
- Discount if permission allows.

## 30. Pricing and GST

Selling price is global across both locations.

- Product prices are stored/displayed GST-inclusive.
- v1 assumes standard Australian 10% GST on taxable lines.
- Invoice/quote documents show GST component clearly.
- Reports expose inclusive sales, ex-GST revenue, GST collected, COGS, gross profit, and margin.

Permanent product selling-price changes are Admin-only by default but can be granted to a manager through permissions.

Discounts are permission-controlled and can optionally have a manager maximum percentage.

## 31. Invoices

Invoice sources:

- Job.
- POS sale.
- Quote conversion flow.
- Manual invoice.

Statuses:

- Draft.
- Sent.
- Partially Paid.
- Paid.
- Overdue.
- Cancelled.
- Refunded.

Invoices store immutable snapshots of issued information including:

- Customer/billing identity.
- Product/service description.
- Quantity.
- GST treatment.
- Unit price.
- Discount.
- Cost basis where inventory-linked.

A future product price change must never change an old invoice.

### 31.1 Invoice edit rules

- Draft: editable.
- Sent and unpaid: editable with audit/version history.
- Partially paid: financial totals locked.
- Paid: financial totals locked.

Corrections to paid/partially paid invoices use explicit refund/credit/cancellation workflows rather than rewriting financial history.

## 32. Payment Terms and Receivables

Supported payment terms:

- Due on receipt.
- 7 days.
- 14 days.
- 30 days.

The system tracks:

- Due date.
- Original amount.
- Paid amount.
- Balance.
- Due/overdue state.
- Aging buckets.

No customer credit-limit feature in v1.

## 33. Payments

Supported payment methods:

- Cash.
- EFTPOS/card terminal recorded manually.
- Bank transfer.
- Online card payment through Stripe.

Features:

- Full payment.
- Partial payment.
- Split payment.
- Payment reference.
- Payment notes.
- Refunds.
- Payment audit history.

Invoice balance and status update from payment transactions, not from arbitrary manual status edits.

## 34. Stripe Online Payments

Online card payments use Stripe-hosted payment UI so raw card data never enters the inventory application.

Recommended v1 implementation uses a Stripe Checkout Session or equivalent hosted flow tied to one invoice.

Requirements:

- Invoice ID and location stored in Stripe metadata.
- Webhook signature verification.
- Idempotent webhook processing.
- Duplicate Stripe events cannot duplicate application payments.
- Successful payment updates invoice balance/status and sends receipt.
- Reconciliation screen identifies matched and Needs Review payments.

## 35. Refunds and Returns

Refunds and inventory returns are separate actions.

Refund workflow records:

- Payment.
- Refund amount.
- Full/partial status.
- Mandatory reason.
- User.
- Timestamp.
- Stripe refund reference where applicable.

A returned physical item is added back to stock only through an explicit stock-return movement.

Damaged/unusable returns do not automatically become available inventory.

## 36. Email and Reminders

One shared business sender is used for both locations.

Email types:

- Quote.
- Invoice.
- Receipt.
- Online payment link.
- Purchase order.
- Payment reminder.

Every customer-facing document still identifies the relevant location.

### 36.1 Reminder schedule

Automatic invoice email reminders:

- 3 days before due date.
- On due date.
- 7 days overdue.
- 14 days overdue.

Reminders stop once invoice balance reaches zero or invoice is cancelled.

Recommended scheduler: a daily authenticated Vercel Cron/server task that selects only reminders due for that run and writes delivery state for idempotency.

### 36.2 Email failure handling

If document creation succeeds but email delivery fails:

- Keep the business record valid.
- Mark email as failed/not sent.
- Show Retry Email action.
- Preserve delivery attempts.

## 37. Documents

Generated documents:

- Quotes.
- Tax invoices.
- Receipts.
- Purchase orders.
- Credit/refund documents.
- Transfer documents.

Documents use 24/7 Truck Tyre Services branding and location details.

Admin settings include:

- Business name.
- ABN.
- Address.
- Phone.
- Shared email.
- Logo.
- Bank/payment instructions.
- Invoice footer.
- Quote validity.
- Location addresses/phones.

## 38. Reports

Admin can report across All Locations, Lonsdale, or Regency Park.

Managers are restricted to their location and permissions.

Date filters:

- Today.
- Yesterday.
- This week.
- This month.
- Last month.
- This quarter.
- Financial year.
- Custom range.

### 38.1 Sales and profit

Expose:

- Sales incl. GST.
- GST component.
- Ex-GST revenue.
- COGS.
- Gross profit.
- Gross margin %.
- Location comparison.

### 38.2 Inventory valuation

Inventory value is based on current location WAC.

Drilldown by:

- Location.
- Category.
- Product.
- New/used.
- Brand.
- Size.

### 38.3 Product performance

Expose:

- Quantity sold.
- Revenue.
- COGS.
- Gross profit.
- Gross margin.

### 38.4 Slow-moving stock

Filters:

- No sales for 30 days.
- 60 days.
- 90 days.
- 180+ days.

### 38.5 Stock movements

Filter by movement type, location, product, date, and user.

### 38.6 Stock adjustments

Dedicated Admin review report with previous/new quantity, difference, reason, manager, location, and timestamp.

### 38.7 Stocktakes

Expose total system quantity, counted quantity, variance, products with variance, and movement links.

### 38.8 Customer and fleet reporting

Expose:

- Top customers.
- Revenue by customer.
- Jobs per customer.
- Average invoice value.
- Outstanding balance.
- Last activity.

### 38.9 Accounts receivable

Aging buckets:

- Current.
- 1–7 days overdue.
- 8–14 days overdue.
- 15–30 days overdue.
- 30+ days overdue.

### 38.10 Payment reconciliation

Breakdown by:

- Cash.
- EFTPOS.
- Bank transfer.
- Online Stripe.
- Refunds.

### 38.11 Purchasing

Expose supplier spend, location spend, last purchase cost, cost trends, open POs, and partially received POs.

### 38.12 Transfers

Expose transfer value, status, most transferred products, in-transit value, and discrepancies.

### 38.13 Job reporting

Expose jobs completed/cancelled, revenue, parts used, labour charged, average job value, manager, and location.

### 38.14 Exports

Reports support:

- CSV.
- Excel-compatible CSV.
- PDF.
- Print.

v1 provides accounting-supporting reports but does not replace formal accounting software or BAS preparation.

## 39. Audit Log

Audit records are immutable and cannot be edited or deleted by users.

Audit sensitive events including:

- Login.
- User creation/disable.
- Permission changes.
- Price changes.
- Cost changes.
- Stock adjustments.
- Stocktakes.
- PO creation/submission/approval/rejection.
- PO receiving.
- Transfer requests/approval/dispatch/receipt/discrepancy resolution.
- Quote/job/invoice changes.
- Discounts.
- Payments.
- Refunds.
- Customer changes.
- System settings.

Each record includes where applicable:

- User.
- Location.
- Action.
- Entity type and ID.
- Previous value.
- New value.
- Timestamp.
- Reason.

Application/system error logs remain separate from business audit logs.

## 40. Notifications

Internal notification centre supports:

- PO awaiting approval.
- Transfer awaiting approval.
- Incoming transfer ready to receive.
- Transfer discrepancy.
- Low stock.
- Invoice overdue.
- Online payment received.
- PO partially received.
- Stocktake completed.
- Important stock adjustment.

Admin sees cross-location notifications.

Managers see only notifications relevant to their location and permissions.

Internal operational notifications remain primarily in-app; customer/supplier communications use email.

## 41. Database Model

Core tables/modules:

### Identity and authorisation

- `profiles`.
- `roles`.
- `permissions`.
- `role_permissions`.
- `user_permissions`.
- `user_location_assignments`.

### Locations and numbering

- `locations`.
- `document_sequences`.

### Products and inventory

- `product_categories`.
- `products`.
- `tyre_attributes`.
- `inventory_units` for individually tracked used tyres.
- `inventory_balances`.
- `inventory_movements`.
- `inventory_reservations`.
- `stock_adjustments`.
- `stocktakes`.
- `stocktake_lines`.

### Suppliers and purchasing

- `suppliers`.
- `product_suppliers`.
- `purchase_orders`.
- `purchase_order_lines`.
- `goods_receipts`.
- `goods_receipt_lines`.

### Transfers

- `stock_transfers`.
- `stock_transfer_lines`.
- `stock_transfer_events`.

### Customers

- `customers`.
- `customer_contacts`.
- `customer_vehicles`.

### Sales and operations

- `quotes`.
- `quote_lines`.
- `jobs`.
- `job_lines`.
- `invoices`.
- `invoice_lines`.
- `payments`.
- `refunds`.

### Communication

- `email_deliveries`.
- `invoice_reminder_schedule` or idempotent reminder delivery records.
- `notifications`.

### Governance

- `audit_logs`.
- `file_attachments`.
- application/system logs outside immutable business audit history.

## 42. Database Invariants

The database must enforce the following invariants where practical:

- One active manager primary-location assignment in v1.
- Managers cannot access records outside authorised location scope.
- Available stock cannot become negative.
- Inventory movements are append-only after posting; corrections use reversing/adjusting movements.
- Finalised transfer dispatch cannot be executed twice.
- Finalised transfer receipt cannot be executed twice.
- PO receipt cannot exceed remaining ordered quantity.
- Document numbers are unique per type/location sequence.
- Payment external IDs are unique when supplied by Stripe.
- Stripe event IDs are processed idempotently.
- Paid/partially paid invoice financial totals cannot be directly mutated through normal application flows.
- Audit records cannot be updated/deleted by application users.

## 43. Transaction Boundaries

The following operations must be atomic database transactions or equivalent stored procedures:

### Job completion

- Validate stock/reservations.
- Consume inventory.
- Capture cost basis.
- Complete job.
- Create invoice when selected.
- Write audit entries.

### POS finalisation

- Validate stock.
- Consume inventory.
- Create/finalise invoice.
- Record immediate payment when supplied.
- Write audit entries.

### PO receipt

- Validate outstanding quantities.
- Create goods receipt.
- Create inventory movements.
- Update balances/WAC.
- Update PO status.
- Write audit entries.

### Transfer dispatch

- Revalidate source stock.
- Snapshot transfer unit cost.
- Deduct source stock.
- Create transfer-out movements.
- Mark In Transit.
- Write audit entries.

### Transfer receipt

- Validate transfer state.
- Add received destination stock.
- Recalculate destination WAC.
- Create transfer-in movements.
- Update discrepancy/completion state.
- Write audit entries.

### Payment webhook

- Verify event.
- Deduplicate event/payment.
- Record payment.
- Recalculate invoice balance/status.
- Queue/send receipt.
- Write audit entry.

## 44. Concurrency and Version Control

Important mutable records use optimistic version checks or equivalent concurrency control.

If a record changes after a user opens it, stale updates are rejected with a clear message instead of silently overwriting newer data.

Applies to:

- Purchase orders.
- Transfers.
- Jobs.
- Quotes.
- Invoices where editable.
- Stocktakes.

## 45. Soft Deletion and Archiving

Operational history is not physically deleted through normal UI.

Use:

- Product → Archived.
- Customer → Inactive.
- Supplier → Inactive.
- User → Disabled.
- Invoice → Cancelled/voided.
- PO → Cancelled.

Historical links remain intact.

## 46. File Storage

Protected Supabase Storage contains:

- Used tyre photos.
- Supplier invoices/documents.
- Job photos.
- Generated document files where persisted.
- Other authorised attachments.

File access must honour the same role/location rules as its parent record.

## 47. Error and Failure Handling

User-facing errors must be operationally clear.

Examples:

- `Cannot remove 4 tyres. Only 3 are currently available at Lonsdale.`
- `You do not have permission to issue refunds.`
- `This purchase order changed since you opened it. Refresh and review the latest version.`

Do not expose raw database errors to users.

### 47.1 Online-only behaviour

When connection is unavailable:

- Show offline state.
- Do not queue stock, payment, transfer, or PO mutations for later replay.
- Do not show an action as successful until the server confirms it.

The PWA may cache static application assets for installation/performance, but v1 does not support offline business-data mutation or offline synchronisation.

### 47.2 Duplicate-submit protection

Sensitive action buttons become disabled while processing.

Server/database idempotency must also protect against retries for payments, receipts, and other externally retried events.

## 48. Performance

Database indexes should support frequent search/filter paths including:

- Product size.
- Brand.
- Pattern.
- Part number.
- Customer/company name.
- Phone.
- Registration.
- Quote/job/invoice/PO/transfer number.
- Location and status.
- Movement date.

Large datasets use server pagination and filtering.

Do not load unbounded inventory movements, invoices, jobs, or audit logs into one client request.

## 49. Security

Requirements:

- Supabase Auth.
- Row-level security for location-scoped business data.
- Server-side permission checks for every sensitive mutation.
- Service-role credentials server-only.
- Stripe secret/webhook secret server-only.
- Resend key server-only.
- Rate limiting for sensitive/publicly reachable endpoints.
- Protected storage policies.
- No raw payment-card storage.
- No secrets with `NEXT_PUBLIC_` exposure.

## 50. Backups and Environments

Use separate staging/development and production environments.

Production requirements:

- Automated Supabase/Postgres backups.
- Versioned database migrations.
- Deployment history.
- Environment-variable separation.
- Recovery procedure documentation.

Never run destructive integration or concurrency tests against production.

## 51. PWA Behaviour

The application is installable as `24/7 Inventory`.

Supported surfaces:

- Windows desktop/browser.
- Android browser/home screen.
- iPhone/iPad home screen.
- Standard desktop browsers.

PWA scope in v1:

- Installable manifest.
- App icon/branding.
- Standalone display mode.
- Static asset caching where safe.
- No offline stock/payment mutation.

## 52. Responsive Design Targets

Test at minimum:

### Desktop

- 1920×1080.
- 1440×900.
- 1366×768.

### Tablet

- Portrait.
- Landscape.

### Mobile

- Common Android widths.
- Common iPhone widths.
- Small-screen layout.

Important actions must not depend on hover, right-click, or mouse-only interaction.

## 53. Testing Strategy

### 53.1 Inventory tests

- Receiving PO adds stock.
- Partial receiving cannot over-receive.
- Quick Stock-In recalculates WAC.
- Job completion reduces stock.
- POS sale reduces stock.
- Job cancellation releases reservation.
- Negative stock is rejected.
- Stock adjustment creates audit record.
- Stocktake creates correct variances.
- Transfer dispatch removes source stock.
- Transfer receipt adds destination stock.
- Transfer cannot dispatch or receive twice.
- Discrepancy flow preserves unresolved quantity.

### 53.2 Costing tests

- WAC recalculates after inbound purchase.
- Sale does not alter WAC.
- Transfer snapshots source WAC.
- Destination WAC includes transferred cost correctly.
- Historical invoice COGS/profit remains unchanged after future purchase-price changes.
- Refund does not silently alter inventory.

### 53.3 Permission/security tests

- Lonsdale manager cannot access Regency Park records.
- Regency Park manager cannot access Lonsdale records.
- Manager cannot approve PO without permission.
- Manager cannot approve transfer in v1.
- Manager cannot view cost when permission disabled.
- Manager cannot edit global price when permission disabled.
- Admin can access both locations.
- Direct URL/API access respects the same rules as the UI.

### 53.4 Financial tests

- GST-inclusive calculations.
- Partial payments.
- Split payments.
- Invoice reaches Paid only when balance is zero.
- Due/overdue calculation.
- Reminder schedule selection.
- Refund idempotency.
- Stripe webhook idempotency.
- Partially paid/paid invoice totals are locked.

### 53.5 Document tests

Validate:

- Business details.
- Location details.
- Numbering.
- GST.
- Totals.
- Customer information.
- Payment status.
- Logo.
- Page breaks.
- Print/PDF rendering.

### 53.6 End-to-end workflows

**Purchase:** Low Stock → PO → Admin Approval → Receive → Inventory Updated.

**Workshop job:** Customer → Job → Add Tyres → Labour → Complete → Invoice → EFTPOS Payment → Receipt.

**Fleet account:** Business Customer → Job → Invoice → Terms → Reminder → Bank Payment → Paid.

**Transfer:** Lonsdale/Regency Request → Admin Approves → Dispatch → In Transit → Receive → Complete.

**Online payment:** Invoice → Stripe Checkout → Webhook → Payment → Paid → Receipt.

## 54. Deployment

Recommended topology:

```text
GitHub
  ↓
Vercel — standalone 24/7 Inventory Next.js application
  ↓
Supabase
  ├─ PostgreSQL
  ├─ Auth
  └─ Storage

External services
  ├─ Stripe
  └─ Resend
```

The inventory application should be deployed separately from the public website so internal authentication, operational releases, and business data concerns remain isolated.

This design specification is stored in the existing 24/7 project repository for project continuity; implementation should create and deploy the inventory application as its own standalone app rather than mixing internal screens into the public marketing routes.

## 55. Production Quality Gates

Before production deployment:

- Lint passes.
- TypeScript passes.
- Unit/integration tests pass.
- Database tests pass.
- Production build passes.
- Critical E2E workflows pass.
- Migration validation passes in staging.
- Security/location-permission tests pass.
- Stripe webhook tests pass.
- Email delivery/failure handling is verified.

## 56. Initial Data Setup

Initial production setup includes:

- Lonsdale location with `LON` prefix.
- Regency Park location with `REG` prefix.
- First Admin account.
- Manager accounts assigned to one location each.
- Custom manager permissions.
- Business details, logo, ABN, shared email, payment instructions, and document footer.
- Stripe connection.
- Resend configuration.

## 57. Initial Inventory Import

Support CSV import for existing stock.

Import fields may include:

- Category.
- Product name.
- Brand.
- Pattern.
- Size.
- Condition.
- Lonsdale quantity.
- Regency Park quantity.
- Initial cost/WAC basis.
- Selling price.
- Minimum stock.
- Reorder quantity.
- Preferred supplier.

Import flow:

1. Upload CSV.
2. Parse and validate.
3. Show row-by-row errors/warnings.
4. Preview valid changes.
5. Confirm import.
6. Commit valid import atomically or in clearly defined batches with full import audit history.

No silent partial import is allowed.

## 58. Delivery Phases

### Phase 1 — Inventory Foundation

- Authentication.
- Roles/locations.
- Products.
- New/used tyre model.
- Inventory ledger.
- Stock In/Out.
- Adjustments.
- WAC.
- Low-stock rules.
- Core desktop/mobile shell.

### Phase 2 — Purchasing and Transfers

- Suppliers.
- Purchase orders.
- Admin approval.
- Receiving.
- Goods receipts.
- Inter-location transfers.
- Transfer discrepancy handling.
- Full stocktake.

### Phase 3 — Customers and Jobs

- Individual/business customers.
- Fleet vehicles.
- Quotes.
- Jobs.
- Reservations.
- POS.

### Phase 4 — Finance and Communication

- Invoices.
- Payment terms.
- Cash/EFTPOS/bank payments.
- Stripe online payment.
- Refunds.
- Resend emails.
- Reminder automation.
- Receivables.

### Phase 5 — Reporting and Production Polish

- Sales/profit reports.
- Inventory valuation.
- Product and customer reporting.
- Adjustment/stocktake reporting.
- Supplier/purchasing reporting.
- Transfer reporting.
- Audit dashboards.
- CSV/PDF exports.
- PWA polish.
- Production QA.

## 59. Explicit v1 Exclusions

To control scope, v1 does **not** include:

- Barcode scanning.
- QR scanning.
- Offline business-data editing/synchronisation.
- Native iOS/Android codebase.
- More than two active locations.
- Service-vehicle inventory locations.
- Customer membership/roadside entitlement plans.
- Credit limits.
- Payroll/time tracking.
- Automatic supplier ordering.
- Full accounting ledger or BAS replacement.
- Fixed labour/service catalogue.
- Multi-currency.

The architecture should not prevent these features later, but they are not part of initial implementation.

## 60. Acceptance Summary

The v1 system is successful when:

1. Admin can operate and report across both Lonsdale and Regency Park.
2. Each manager is securely restricted to one assigned location with configurable permissions.
3. Products and used/new tyres can be managed quickly on PC and mobile.
4. Every stock change has an auditable source movement.
5. Negative stock cannot occur through valid application workflows.
6. WAC and inventory valuation remain accurate by location.
7. Managers can create POs and Admin can approve them before supplier sending.
8. Partial PO receiving updates stock and costing correctly.
9. Admin-controlled two-step transfers accurately represent dispatch, in-transit stock, receipt, and discrepancies.
10. Customers, fleet vehicles, quotes, jobs, POS, invoices, and payments are linked without duplicate data entry.
11. GST-inclusive pricing and invoice totals are correct.
12. Cash, EFTPOS, bank transfer, partial/split, and Stripe payments reconcile correctly.
13. Automatic invoice reminders run at the approved schedule and stop when paid.
14. Reports provide trustworthy sales, COGS, gross profit, inventory valuation, receivables, supplier, and transfer information.
15. Audit history cannot be silently rewritten.
16. The PWA is comfortable to use on workshop phones/tablets and desktop PCs.
17. Critical inventory, permission, payment, and transfer workflows pass automated and end-to-end tests before production launch.
