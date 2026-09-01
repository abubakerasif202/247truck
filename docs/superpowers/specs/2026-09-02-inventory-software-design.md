# 24/7 Truck Tyre Services Inventory Software — Design Specification

**Date:** 2026-09-02  
**Status:** Overall design approved; written specification pending final user review  
**Business:** 24/7 Truck Tyre Services  
**Locations:** Lonsdale and Regency Park  
**Product form:** Standalone internal inventory, workshop, POS and invoicing application with responsive PC and mobile UI

## 1. Objective

Build a standalone operational system for 24/7 Truck Tyre Services covering inventory, purchasing, inter-location transfers, customers, fleet accounts, jobs, POS sales, invoicing, payments, receivables, reporting and audit history across Lonsdale and Regency Park.

The application is separate from the public marketing website. It will be installable as a PWA on desktop and mobile while remaining online-only in v1.

Primary goals:

- Fast workshop use on PC, tablet and phone.
- Accurate stock quantities and valuation.
- Strong location isolation for managers.
- Admin approval over purchasing and transfers.
- Reliable audit trails for stock and financial actions.
- A modular foundation that can later support more locations, native apps or additional business modules without rebuilding the core.

## 2. Technical Architecture

Recommended production stack:

- Node.js 22.x.
- Next.js 16.
- React 19.
- TypeScript 5.
- Tailwind CSS 4.
- shadcn/ui.
- Supabase PostgreSQL.
- Supabase Auth.
- Supabase Storage.
- Stripe for online invoice payments.
- Resend for transactional email.
- Vercel for deployment.

The existing 24/7 project already follows the same broad Next.js, Vercel, Resend and Supabase direction, but the inventory system remains its own internal application and deployment.

### Deployment boundary

The inventory software must not be mixed into public marketing routes. It should run as a separate authenticated application/deployment. This design specification remains in the existing 24/7 repository for project continuity.

## 3. Roles, Location Isolation and Permissions

### 3.1 Admin

Admin has full access to both locations and all system settings.

Admin can:

- View and manage Lonsdale and Regency Park.
- Use All Locations reporting.
- Manage users and manager permissions.
- Manage global selling prices.
- View cost, stock value and profit.
- Approve or reject purchase orders.
- Approve or reject transfers.
- Resolve transfer discrepancies.
- Configure business, invoice, payment, email and document settings.
- Review all audit history.

### 3.2 Manager

Each manager is assigned to exactly one primary location.

- Lonsdale Manager → Lonsdale operational access only.
- Regency Park Manager → Regency Park operational access only.
- A manager cannot switch location scope.
- Location restrictions are enforced server-side and through database policies, not only through hidden UI controls.

### 3.3 Custom manager permissions

Admin can enable or disable operational permissions for each manager.

Permission groups include:

**Sales**

- View customers.
- Edit customers.
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
- Stock adjustments.
- Full stocktake.
- View cost price.
- Edit global selling price.

**Purchasing**

- Create purchase orders.
- Submit purchase orders.
- Receive purchase orders.
- Quick Stock-In.

**Transfers**

- Request transfer.
- Dispatch approved outbound transfer.
- Receive approved inbound transfer.

**Reporting**

- View sales reports.
- View stock reports.
- View inventory value.
- View profit.
- Export reports.

### 3.4 Hard Admin-only controls in v1

The following are role-level Admin controls and are not grantable to managers in v1:

- Approve/reject purchase orders.
- Approve/reject transfer requests.
- Resolve transfer discrepancies.
- Create or manage Admin accounts.
- Manage permission definitions.
- Manage business/system integration settings.
- Access All Locations data.

This preserves the approval model explicitly selected for purchasing and transfers.

## 4. Authentication

v1 uses email and password.

Requirements:

- Supabase Auth-backed login.
- Password reset by email.
- Secure server sessions.
- Admin can disable manager accounts.
- Admin can revoke sessions.
- Login activity is auditable.
- 2FA is not required in v1 but can be added later without redesigning roles or data ownership.

## 5. Locations and Record Numbering

Initial active locations:

1. **Lonsdale** — code `LON`.
2. **Regency Park** — code `REG`.

Admin scope selector:

- All Locations.
- Lonsdale.
- Regency Park.

Managers never receive All Locations mode.

Operational numbers are generated atomically per location and record type.

### Lonsdale examples

- `LON-QUO-000001` — Quote.
- `LON-JOB-000001` — Job.
- `LON-INV-000001` — Invoice.
- `LON-PO-000001` — Purchase Order.
- `LON-TRF-000001` — Transfer whose source is Lonsdale.
- `LON-STK-000001` — Stocktake.
- `LON-GRN-000001` — Goods Receipt.

### Regency Park examples

- `REG-QUO-000001`.
- `REG-JOB-000001`.
- `REG-INV-000001`.
- `REG-PO-000001`.
- `REG-TRF-000001`.
- `REG-STK-000001`.
- `REG-GRN-000001`.

## 6. Desktop and Mobile Application Shell

### Desktop

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

Top bar:

- Global search.
- Admin location scope selector.
- Notifications.
- User menu.

Desktop pages use business-oriented tables, filters, quick actions and keyboard-friendly workflows.

### Mobile

Bottom navigation:

- Home.
- Stock.
- Jobs.
- Customers.
- More.

`More` contains:

- Quotes.
- Invoices.
- Payments.
- Purchase Orders.
- Transfers.
- Suppliers.
- Reports.
- Settings.

High-frequency mobile actions:

- Stock In.
- Stock Out.
- New Job.
- New Quote.
- New Invoice.
- Purchase Order.
- Transfer Request.

The mobile UI is purpose-designed with large touch targets and short forms rather than being a compressed desktop table.

## 7. Dashboard

### Admin dashboard

Show:

- Total inventory value.
- Today’s sales.
- Outstanding invoices.
- Low-stock items.
- Stock in transit.
- Pending PO approvals.
- Pending transfer approvals.
- Transfer discrepancies.
- Recent stock adjustments.

Location comparison includes:

- Stock value.
- Sales.
- Jobs.
- Low-stock count.
- Overdue invoices.

### Manager dashboard

Show only the assigned location:

- Today’s sales.
- Jobs today.
- Low-stock warnings.
- POs awaiting Admin approval.
- Transfers awaiting action.
- Unpaid/overdue invoices.
- Recent stock movements.

## 8. Global Search

Searchable fields include:

- Product name.
- Tyre size.
- Brand.
- Pattern.
- Part/reference number.
- Customer name.
- Company name.
- Phone.
- Email.
- Vehicle registration.
- Fleet number.
- ABN.
- Quote number.
- Job number.
- Invoice number.
- PO number.
- Transfer number.

Search results remain permission- and location-aware.

## 9. Inventory Scope

v1 manages tyres plus related workshop stock:

- Truck tyres.
- Rims / wheels.
- Tubes.
- Valves.
- Wheel nuts / studs.
- Repair patches and materials.
- Balancing weights.
- Workshop consumables.
- Other related parts.

No barcode or QR scanning is included.

## 10. Product Model

Common product fields:

- Product name.
- Category.
- Active/archived status.
- Part/reference number where relevant.
- Global GST-inclusive selling price.
- Preferred supplier.
- Notes.

Tyre-specific fields:

- New / Used.
- Brand.
- Pattern.
- Size.
- Load index.
- Speed rating.

Tyre size, brand and pattern should use reusable normalised values so inconsistent typing does not create duplicate variants.

## 11. New and Used Tyre Tracking

### New tyres

Normally quantity-tracked by product and location.

Expose per location:

- On hand.
- Reserved.
- Available.
- Minimum stock.
- Reorder quantity.
- Weighted-average cost.

`Available = On Hand - Reserved`.

### Used tyres

Used tyres use hybrid tracking.

**Grouped used stock** is allowed when units are effectively equivalent.

**Individual used tyre records** are used when tread depth, condition, notes, photos or pricing materially differ.

Individual used tyre fields:

- Internal unit ID.
- Brand.
- Pattern.
- Size.
- Tread depth in millimetres.
- Condition.
- Cost basis.
- Optional unit-specific selling price.
- Location.
- Notes.
- Photos.
- Status.

Conditions:

- Excellent.
- Good.
- Fair.
- Scrap.

Statuses:

- Available.
- Reserved.
- Sold.
- Scrap.

A unit-specific used-tyre selling price is not a location price override; it belongs to that specific individually tracked tyre.

## 12. Inventory Ledger and Balance Integrity

Inventory quantities are never silently edited.

Every posted stock change creates an append-only movement containing:

- Product.
- Optional individual unit.
- Location.
- Quantity delta.
- Movement type.
- Source record type/ID.
- User.
- Timestamp.
- Reason/notes where required.
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

Balances must remain reconcilable to the movement ledger.

### No negative stock

Negative stock is never allowed.

Protection occurs at:

1. UI validation.
2. Server validation.
3. Database transaction/locking layer.

Concurrent users cannot oversell the same stock.

## 13. Reservations

Quotes do not reserve stock.

An accepted quote converted to a job may reserve stock.

Rules:

- Reservation reduces Available but not On Hand.
- Completion converts reservation to stock consumption.
- Cancellation releases reservation.
- Reservation cannot exceed Available.

## 14. Weighted Average Cost

Weighted Average Cost (WAC) is used for inventory valuation and COGS.

WAC is location-specific.

For purchased inbound stock:

`New WAC = ((Existing Qty × Existing WAC) + (Received Qty × Unit Cost)) / New Qty`

Rules:

- Sales do not recalculate WAC.
- Job/POS/invoice lines capture their cost basis at consumption time.
- Historical profit does not change when future purchase prices change.
- Cost and profit visibility is permission-controlled for managers.

## 15. Quick Stock In, Stock Out and Adjustments

### Quick Stock-In

Fields:

- Product.
- Location.
- Quantity.
- Unit cost.
- Supplier.
- Supplier invoice/reference.
- Notes.

Saving:

- Creates inventory movement.
- Updates balance.
- Recalculates WAC.
- Creates audit history.

Quick Stock-In is permission-controlled because it bypasses PO approval.

### Stock-Out

Reasons include:

- Damaged.
- Write-off.
- Internal use.
- Missing.
- Data correction.
- Warranty return.
- Supplier return.
- Other.

Quantity cannot exceed available stock.

### Manual adjustment

Managers with permission can adjust their assigned location with a mandatory reason.

Audit record includes:

- Product.
- Previous quantity.
- New quantity.
- Difference.
- Reason.
- Notes.
- User.
- Location.
- Timestamp.

## 16. Full Stocktake

v1 supports full-location stocktake only.

Workflow:

1. Start stocktake for one location.
2. Record physical counts for all active stock.
3. Save progress.
4. Review variances.
5. Confirm stocktake.
6. Create adjustment movements for confirmed differences.

Completed stocktakes preserve original system quantity, counted quantity, difference, user, timestamp and resulting movement references.

## 17. Low Stock and Smart Reordering

Each product has location-specific:

- Minimum stock threshold.
- Reorder quantity.
- Preferred supplier.

When available quantity falls below minimum, show Low Stock.

The system may suggest:

- Create Purchase Order.
- Request transfer from the other location when suitable stock exists.

Suggestions never automatically order or transfer stock.

Selected reorder suggestions can generate a draft PO, grouped by preferred supplier where practical.

## 18. Suppliers and Purchase Orders

Supplier fields:

- Supplier name.
- ABN.
- Contact.
- Phone.
- Email.
- Address.
- Payment terms.
- Account/reference.
- Notes.
- Active/inactive status.

Product-supplier data may contain:

- Supplier SKU.
- Last cost.
- Typical lead time.
- Minimum order quantity.
- Preferred supplier flag.

### PO workflow

`Draft → Submitted for Approval → Approved → Sent to Supplier → Partially Received / Received → Closed`

Alternative statuses:

- Rejected.
- Cancelled.

Manager can:

- Create PO for assigned location.
- Add product lines and supplier costs.
- Add reference/notes/attachments.
- Submit for approval.

Admin can:

- Edit before approval.
- Approve.
- Reject with reason.
- Send approved PO to supplier.

Only Admin approves/rejects POs in v1.

## 19. Purchase Receiving

Partial receiving is supported.

Track per PO line:

- Ordered quantity.
- Previously received.
- Receive now.
- Outstanding quantity.

Each receiving event creates a Goods Receipt.

Atomic receive operation:

- Validates outstanding quantity.
- Blocks over-receiving in v1.
- Creates goods receipt and lines.
- Creates inventory movements.
- Updates balances.
- Recalculates WAC.
- Updates PO status.
- Writes audit history.

The same PO may be received over multiple deliveries.

## 20. Inter-Location Transfers

Workflow:

`Requested → Approved → Dispatched → In Transit → Received → Completed`

Other states:

- Rejected.
- Cancelled.
- Review Required.

### Transfer request rules

A manager may create a request only when their assigned location is one endpoint of the transfer.

Two valid cases:

- **Outbound request:** manager asks to send stock from their own location to the other location.
- **Inbound request:** manager asks Admin for stock from the other location to their own location.

For an inbound request, the manager does not gain detailed access to the other branch’s inventory records. Admin reviews source availability during approval.

The transfer number uses the source location prefix.

### Approval

Only Admin can approve/reject a transfer.

Approval does not move stock.

### Dispatch

Only the sending location’s authorised manager or Admin can dispatch.

Atomic dispatch:

- Revalidates source available stock.
- Captures source WAC as transfer unit cost.
- Deducts source on-hand stock.
- Creates transfer-out movements.
- Marks quantity In Transit.

### Receipt

Only the receiving location’s authorised manager or Admin can receive.

For matching quantities:

- Add destination stock.
- Recalculate destination WAC using captured transfer unit cost.
- Create transfer-in movements.
- Complete transfer when all lines are resolved.

### Discrepancy

If received quantity differs from dispatched quantity:

- Require discrepancy note.
- Do not silently complete transfer.
- Book the quantity actually confirmed as received where safe.
- Keep unresolved quantity represented as unresolved in-transit/discrepancy stock.
- Mark transfer Review Required.
- Admin resolves through explicit auditable disposition such as return-to-sender or approved write-off.

No transfer quantity may disappear without a movement.

## 21. Customers and Fleet Accounts

### Individual customer

Fields:

- Name.
- Mobile.
- Email.
- Address.
- Notes.

Individual customers default to **Due on receipt** in v1.

### Business / fleet customer

Fields:

- Company name.
- ABN.
- Billing address.
- Primary contact.
- Phone.
- Email.
- Payment terms.
- Notes.

Business/fleet accounts can contain:

- Multiple contacts.
- Multiple trucks/trailers.
- Registrations.
- Fleet numbers.
- Customer PO/reference requirements.
- Quote/job/invoice/payment history.

Supported business payment terms:

- Due on receipt.
- 7 days.
- 14 days.
- 30 days.

No customer credit-limit feature in v1.

## 22. Vehicles

Vehicle fields may include:

- Registration.
- Vehicle type.
- Make/model.
- Fleet number.
- Trailer registration.
- Notes.

Vehicle registration is globally searchable within the user’s authorised data scope.

## 23. Quotes and Jobs

### Quotes

Statuses:

- Draft.
- Sent.
- Accepted.
- Declined.
- Expired.
- Cancelled.
- Converted to Job.

Quote lines may include:

- Products.
- Free-text labour/service.
- Other charges.
- Authorised discounts.

Quotes do not deduct inventory.

Accepted quotes can convert to jobs without re-entering customer, vehicle, product, labour, price or notes.

### Jobs

Statuses:

- New.
- Scheduled.
- In Progress.
- Waiting.
- Completed.
- Cancelled.

Job data includes:

- Customer/contact.
- Vehicle/fleet reference.
- Customer PO/reference.
- Location.
- Manager.
- Description.
- Date/time.
- Internal/customer notes.
- Product lines.
- Free-text labour/service lines.
- Other charges.

Job completion atomically:

- Revalidates stock and reservations.
- Converts reservation to consumption.
- Captures cost basis.
- Creates inventory movements.
- Marks job Completed.
- Creates linked invoice when selected.
- Writes audit history.

Cancelling a job releases active reservations.

## 24. POS and Direct Sales

POS supports transactions that do not require a full job, including counter tyre/parts sales and simple workshop transactions.

A built-in Walk-In Customer avoids mandatory customer creation.

Flow:

1. Select customer or Walk-In Customer.
2. Add inventory items.
3. Add optional free-text labour/service.
4. Review GST-inclusive total.
5. Finalise sale.
6. Consume stock atomically.
7. Create invoice/receipt.
8. Record payment or leave an authorised business invoice outstanding.

For individual/walk-in customers, direct POS sales default to immediate payment.

## 25. Labour, Pricing, Discounts and GST

v1 has no fixed service catalogue.

Labour/service lines contain:

- Free-text description.
- Quantity/hours.
- GST-inclusive unit price.
- Optional internal note.
- Discount if permitted.

Product selling price is global across both locations.

v1 assumes standard Australian **10% GST** on taxable lines.

Reports and documents expose:

- GST-inclusive sales.
- GST component.
- Ex-GST revenue.
- COGS.
- Gross profit.
- Gross margin.

Permanent product price changes are Admin-only by default but can be granted as a manager permission.

Discount permission can optionally include a maximum manager discount percentage.

## 26. Invoices and Financial Integrity

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
- Partially Refunded.
- Refunded.
- Cancelled.

Issued invoices snapshot:

- Customer/billing identity.
- Description.
- Quantity.
- GST treatment.
- Unit price.
- Discount.
- Cost basis for inventory-linked lines.

Future product/customer changes do not rewrite historical invoice snapshots.

### Invoice edit rules

- Draft: editable.
- Sent and unpaid: editable with version/audit history.
- Partially paid: financial totals locked.
- Paid: financial totals locked.

Corrections after payment use explicit refund/credit/cancellation flows instead of rewriting totals.

## 27. Payments, Stripe, Refunds and Receivables

Supported payment methods:

- Cash.
- EFTPOS/card terminal recorded manually.
- Bank transfer.
- Online card payment via Stripe.

Support:

- Full payment.
- Partial payment.
- Split payment.
- Payment reference.
- Payment notes.
- Full refund.
- Partial refund.

Invoice balance/status is derived from financial transactions rather than arbitrary status edits.

### Stripe

Use Stripe-hosted checkout/payment UI so raw card details never enter the application.

Requirements:

- Invoice ID and location in Stripe metadata.
- Webhook signature verification.
- Unique external payment/event identifiers.
- Idempotent webhook processing.
- Duplicate webhook delivery cannot duplicate a payment.
- Successful payment updates invoice state and can trigger receipt email.
- Reconciliation screen shows Matched or Needs Review.

### Refund and physical return separation

A financial refund does not automatically alter stock.

If a physical item is returned:

- A separate stock-return movement is required.
- Usable stock can return to Available.
- Damaged/unusable returns do not automatically become sellable inventory.

### Receivables

Track:

- Due date.
- Original amount.
- Paid amount.
- Balance.
- Current/overdue state.
- Aging buckets.

Aging buckets:

- Current.
- 1–7 days overdue.
- 8–14 days overdue.
- 15–30 days overdue.
- 30+ days overdue.

## 28. Email and Automatic Reminders

One shared business sender is used for both locations.

Email types:

- Quote.
- Invoice.
- Receipt.
- Online payment link.
- Purchase order.
- Payment reminder.

Documents still identify Lonsdale or Regency Park as appropriate.

Approved automatic reminder schedule:

- 3 days before due date.
- On due date.
- 7 days overdue.
- 14 days overdue.

Reminders stop when balance reaches zero or the invoice is cancelled.

Recommended scheduler: daily authenticated Vercel Cron/server task with idempotent reminder-delivery records.

If email delivery fails:

- Keep the invoice/PO/quote valid.
- Mark email as failed/not sent.
- Preserve delivery attempt.
- Show Retry Email.

## 29. Documents

Generated documents include:

- Quotes.
- Tax invoices.
- Receipts.
- Purchase orders.
- Credit/refund documents.
- Transfer documents.

Use 24/7 Truck Tyre Services branding.

Admin-configurable business settings:

- Business name.
- ABN.
- Business address.
- Phone.
- Shared email.
- Logo.
- Bank/payment instructions.
- Invoice footer.
- Quote validity.
- Lonsdale contact/address details.
- Regency Park contact/address details.

## 30. Reporting

Admin can filter reports by All Locations, Lonsdale or Regency Park.

Managers are restricted to their assigned location and permission set.

Date filters:

- Today.
- Yesterday.
- This week.
- This month.
- Last month.
- This quarter.
- Financial year.
- Custom range.

Reports include:

### Sales and profit

- Sales incl. GST.
- GST component.
- Ex-GST revenue.
- COGS.
- Gross profit.
- Gross margin %.
- Location comparison.

### Inventory valuation

- Current WAC value by location.
- Category.
- Product.
- New/used.
- Brand.
- Size.

### Product performance

- Quantity sold.
- Revenue.
- COGS.
- Gross profit.
- Gross margin.

### Slow-moving stock

Filters for no sales in 30 / 60 / 90 / 180+ days.

### Stock controls

- Stock movement report.
- Low-stock report.
- Stock-adjustment report.
- Stocktake variance report.

### Customer/fleet

- Top customers.
- Revenue by customer.
- Jobs per customer.
- Average invoice value.
- Outstanding balance.
- Last activity.

### Payments and receivables

- Aging report.
- Cash/EFTPOS/bank/Stripe breakdown.
- Refunds.
- End-of-day reconciliation support.

### Purchasing and suppliers

- Supplier spend.
- Spend by location.
- Last purchase cost.
- Cost trends.
- Open and partially received POs.

### Transfers

- Transfer value.
- In-transit value.
- Most transferred products.
- Status history.
- Discrepancies.

### Jobs

- Completed/cancelled jobs.
- Revenue.
- Parts used.
- Labour charged.
- Average job value.
- Manager.
- Location.

Exports:

- CSV.
- Excel-compatible CSV.
- PDF.
- Print.

The system provides accounting-supporting reports but does not replace formal accounting software or BAS preparation in v1.

## 31. Audit Log

Audit history is immutable to application users.

Audit events include:

- Login.
- User create/disable.
- Permission changes.
- Selling-price changes.
- Cost changes.
- Stock adjustments.
- Stocktakes.
- PO create/submit/approve/reject/receive.
- Transfer request/approve/dispatch/receive/discrepancy resolution.
- Quote/job/invoice edits.
- Discounts.
- Payments.
- Refunds.
- Customer changes.
- Business/system settings.

Each record includes where applicable:

- User.
- Location.
- Action.
- Entity type/ID.
- Previous value.
- New value.
- Reason.
- Timestamp.

System/application error logs are separate from business audit history.

## 32. Notifications

Internal notification centre includes:

- PO awaiting approval.
- Transfer awaiting approval.
- Incoming transfer ready to receive.
- Transfer discrepancy.
- Low stock.
- Overdue invoice.
- Online payment received.
- Partially received PO.
- Stocktake completed.
- Significant stock adjustment.

Admin sees both locations.

Managers receive only notifications relevant to their location and permissions.

## 33. Core Data Model

### Identity and authorisation

- `profiles`.
- `roles`.
- `permissions`.
- `user_permissions`.
- `user_location_assignments`.

### Locations and numbering

- `locations`.
- `document_sequences`.

### Products and inventory

- `product_categories`.
- `products`.
- `tyre_attributes`.
- `inventory_units`.
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

### Operations and sales

- `quotes`.
- `quote_lines`.
- `jobs`.
- `job_lines`.
- `invoices`.
- `invoice_lines`.
- `payments`.
- `refunds`.

### Communication and governance

- `email_deliveries`.
- `reminder_deliveries`.
- `notifications`.
- `audit_logs`.
- `file_attachments`.

## 34. Database Invariants

Enforce where practical:

- One primary location per manager in v1.
- Manager location isolation.
- Available stock cannot become negative.
- Posted inventory movements are append-only; corrections use reversing/adjusting movements.
- Transfer dispatch cannot post twice.
- Transfer receipt cannot post twice.
- PO receiving cannot exceed remaining ordered quantity.
- Document numbers are unique.
- Stripe external payment/event IDs are unique.
- Stripe processing is idempotent.
- Paid/partially paid invoice totals cannot be directly mutated through normal flows.
- Audit logs cannot be updated or deleted by application users.

## 35. Atomic Transaction Boundaries

The following operations must be atomic database transactions or equivalent stored procedures.

### Job completion

- Validate stock/reservation.
- Consume stock.
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

### PO receiving

- Validate outstanding quantities.
- Create goods receipt.
- Create stock movements.
- Update balances/WAC.
- Update PO state.
- Write audit entries.

### Transfer dispatch

- Revalidate source stock.
- Snapshot transfer unit cost.
- Deduct source stock.
- Create transfer-out movements.
- Set In Transit.
- Write audit entries.

### Transfer receipt

- Validate transfer state.
- Add actual received destination stock.
- Recalculate destination WAC.
- Create transfer-in movements.
- Update completion/discrepancy state.
- Write audit entries.

### Stripe webhook

- Verify webhook.
- Deduplicate event/payment.
- Record payment/refund event.
- Recalculate invoice/payment state.
- Write audit entry.
- Trigger receipt when appropriate.

## 36. Concurrency and Stale Record Protection

Important mutable records use optimistic version checks and database transaction controls.

If another user changed a record after it was loaded, a stale save is rejected with a clear message rather than overwriting the newer state.

Apply to:

- Purchase orders.
- Transfers.
- Jobs.
- Quotes.
- Editable invoices.
- Stocktakes.

## 37. Soft Deletion and Historical Integrity

Normal UI does not physically delete operational history.

Use states such as:

- Product → Archived.
- Customer → Inactive.
- Supplier → Inactive.
- User → Disabled.
- Invoice → Cancelled/voided.
- PO → Cancelled.

Historical links remain intact.

## 38. File Storage

Protected Supabase Storage may contain:

- Used tyre photos.
- Supplier invoices/documents.
- Job photos.
- Generated documents where persisted.
- Other authorised attachments.

File access must follow the same role and location permissions as the parent business record.

## 39. Error and Failure Handling

User-facing errors must be operational, for example:

- `Cannot remove 4 tyres. Only 3 are available at Lonsdale.`
- `You do not have permission to issue refunds.`
- `This purchase order changed since you opened it. Refresh and review the latest version.`

Raw database errors are not shown to users.

### Online-only v1

If the network is unavailable:

- Show offline state.
- Do not queue stock/payment/transfer/PO mutations for later replay.
- Do not show success until server confirmation.

The PWA may cache static application assets but does not support offline business-data mutation or synchronisation.

### Duplicate-submit protection

Sensitive action buttons disable while processing, and server/database idempotency protects retried operations.

## 40. Security

Requirements:

- Supabase Auth.
- Row Level Security for location-scoped data.
- Server-side permission checks on sensitive mutations.
- Service-role credentials server-only.
- Stripe secret and webhook secret server-only.
- Resend API key server-only.
- No secrets exposed through `NEXT_PUBLIC_`.
- Protected storage policies.
- No raw payment-card storage.
- Rate limiting for sensitive/public endpoints.

## 41. Performance

Index common search/filter columns including:

- Tyre size.
- Brand.
- Pattern.
- Part number.
- Customer/company name.
- Phone.
- Registration.
- Quote/job/invoice/PO/transfer number.
- Location.
- Status.
- Movement/transaction date.

Use server pagination and filtering for large movement, invoice, job and audit datasets.

## 42. Backups and Environments

Maintain separate development/staging and production environments.

Production requirements:

- Automated PostgreSQL/Supabase backups.
- Versioned migrations.
- Deployment history.
- Environment-variable separation.
- Recovery procedure documentation.

Destructive/concurrency integration tests must never run against production.

## 43. PWA and Responsive Targets

App name: **24/7 Inventory**.

Supported surfaces:

- Windows desktop/browser.
- Android browser/home screen.
- iPhone/iPad home screen.
- Standard modern desktop browsers.

v1 PWA scope:

- Installable manifest.
- Business icon/branding.
- Standalone display mode.
- Safe static-asset caching.
- No offline transactional sync.

Test at minimum:

**Desktop**

- 1920×1080.
- 1440×900.
- 1366×768.

**Tablet**

- Portrait.
- Landscape.

**Mobile**

- Common Android widths.
- Common iPhone widths.
- Small-screen layout.

Important actions must not depend on hover, right-click or a mouse.

## 44. Testing Strategy

### Inventory

- PO receipt adds stock.
- Partial receipt cannot over-receive.
- Quick Stock-In recalculates WAC.
- Job completion reduces stock.
- POS reduces stock.
- Job cancellation releases reservation.
- Negative stock is rejected.
- Adjustment creates audit record.
- Stocktake produces correct variance.
- Transfer dispatch removes source stock.
- Transfer receipt adds destination stock.
- Transfer cannot dispatch/receive twice.
- Transfer discrepancy preserves unresolved quantity.

### Costing

- WAC recalculates correctly after purchase.
- Sale does not alter WAC.
- Transfer captures source WAC.
- Destination WAC incorporates transfer cost correctly.
- Historical invoice COGS/profit does not change after future purchase-price changes.
- Refund does not silently change inventory.

### Permissions

- Lonsdale manager cannot access Regency Park records.
- Regency Park manager cannot access Lonsdale records.
- Manager cannot approve PO.
- Manager cannot approve transfer.
- Manager cannot resolve transfer discrepancy.
- Manager cannot view cost when permission is disabled.
- Manager cannot edit selling price when permission is disabled.
- Admin can access both locations.
- Direct API/URL access obeys the same restrictions as UI navigation.

### Financial

- GST-inclusive calculations.
- Partial payments.
- Split payments.
- Invoice becomes Paid only at zero balance.
- Due/overdue calculations.
- Reminder schedule selection.
- Full and partial refunds.
- Stripe webhook idempotency.
- Paid/partially paid invoice totals remain locked.

### Documents

Validate:

- Business details.
- Location details.
- Numbering.
- GST.
- Totals.
- Customer information.
- Payment state.
- Logo.
- Page breaks.
- PDF/print rendering.

### End-to-end workflows

**Purchase:** Low Stock → PO → Admin Approval → Receive → Inventory Updated.

**Workshop job:** Customer → Job → Add Tyres → Labour → Complete → Invoice → EFTPOS Payment → Receipt.

**Fleet account:** Business Customer → Job → Invoice → Payment Terms → Reminder → Bank Payment → Paid.

**Transfer:** Request → Admin Approval → Dispatch → In Transit → Receive → Complete.

**Online payment:** Invoice → Stripe Hosted Checkout → Webhook → Payment → Paid → Receipt.

## 45. Initial Production Setup

Configure:

- Lonsdale with `LON` prefix.
- Regency Park with `REG` prefix.
- First Admin.
- Managers assigned to one location each.
- Custom manager permissions.
- Business name, ABN, logo and shared email.
- Location addresses/contact details.
- Bank/payment instructions.
- Stripe.
- Resend.

## 46. Initial Inventory CSV Import

Support an initial CSV import to avoid manually entering existing stock.

Fields may include:

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

1. Upload.
2. Parse and validate.
3. Show warnings/errors.
4. Preview valid changes.
5. Confirm import.
6. Commit through a controlled audited import process.

No silent partial import is allowed.

## 47. Delivery Phases

The overall system is intentionally split into implementation phases so each phase can be built, tested and accepted before the next.

### Phase 1 — Inventory Foundation

- Standalone app scaffold.
- Auth.
- Roles and location isolation.
- Desktop/mobile shell.
- Product categories/products.
- New/used tyre model.
- Inventory ledger/balances.
- Stock In/Out.
- Adjustments.
- WAC.
- Low-stock rules.

### Phase 2 — Purchasing and Transfers

- Suppliers.
- Purchase orders.
- Admin approval.
- Goods receiving.
- Transfers.
- Transfer discrepancies.
- Full stocktake.

### Phase 3 — Customers, Quotes, Jobs and POS

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
- Stripe.
- Refunds.
- Resend email.
- Automatic reminders.
- Receivables.

### Phase 5 — Reporting and Production Polish

- Sales/profit reports.
- Inventory valuation.
- Product/customer reports.
- Stock adjustment/stocktake reports.
- Supplier/purchasing reports.
- Transfer reports.
- Audit dashboards.
- CSV/PDF exports.
- PWA polish.
- Production QA.

The first implementation plan after this design review should cover **Phase 1 only**. Later phases receive their own detailed implementation plan and acceptance checkpoint.

## 48. Explicit v1 Exclusions

v1 does not include:

- Barcode scanning.
- QR scanning.
- Offline business-data editing/synchronisation.
- Native Android/iOS codebases.
- More than two active locations.
- Service-vehicle inventory locations.
- Customer roadside membership/entitlement plans.
- Customer credit limits.
- Payroll/time tracking.
- Automatic supplier ordering.
- Full accounting ledger/BAS replacement.
- Fixed labour/service catalogue.
- Multi-currency.

The architecture may support these later, but they are outside initial implementation.

## 49. Acceptance Criteria

The v1 platform is successful when:

1. Admin can operate and report across Lonsdale and Regency Park.
2. Managers are securely restricted to one assigned location with configurable operational permissions.
3. PO approval, transfer approval and transfer discrepancy resolution remain Admin-only.
4. Products and new/used tyres can be managed quickly from desktop and mobile.
5. Every posted stock change has an auditable inventory movement.
6. Negative stock cannot occur through valid application workflows.
7. WAC and stock valuation remain accurate by location.
8. Managers can create POs and Admin can approve them before supplier sending.
9. Partial PO receiving updates stock and costing correctly.
10. Two-step transfers accurately represent approval, dispatch, in-transit stock, receipt and discrepancy resolution.
11. Customers, fleet vehicles, quotes, jobs, POS, invoices and payments are linked without duplicate data entry.
12. Individual customers default to immediate payment while business/fleet accounts can use approved 7/14/30-day terms.
13. GST-inclusive pricing and documents calculate correctly.
14. Cash, EFTPOS, bank transfer, partial/split and Stripe payments reconcile correctly.
15. Automatic reminders run at 3 days before due, due date, 7 days overdue and 14 days overdue, then stop when paid.
16. Reports provide trustworthy sales, COGS, gross profit, valuation, receivables, supplier and transfer information.
17. Financial and audit history cannot be silently rewritten.
18. The PWA is practical on workshop phones/tablets and office PCs.
19. Critical inventory, permissions, payments and transfer workflows pass automated and end-to-end tests before production release.
