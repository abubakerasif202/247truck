# 24/7 Truck Tyre Services — Inventory & Business Operations Platform

## Client Project Summary

This project is much more than a basic stock-counting application. It is a complete internal business operations platform designed specifically for 24/7 Truck Tyre Services, covering both **Lonsdale** and **Regency Park** from one secure system.

The purpose is to give the business one central place to manage stock, tyres, suppliers, purchasing, branch transfers, customers, fleet accounts, workshop and roadside jobs, sales, invoices, payments, outstanding accounts, profitability and management reporting.

The software will work on **PC, tablet and mobile**, with a responsive interface built for real workshop use. Managers can operate their own location from a phone or computer, while the business owner/Admin can see both locations together.

---

## Why This Is a Major Business System

The platform combines several systems that businesses normally manage separately:

- Inventory management
- Tyre and workshop stock management
- Multi-location stock control
- Purchase ordering and supplier management
- Inter-branch stock transfers
- Customer and fleet account management
- Quote and job management
- Point-of-sale sales
- Tax invoicing
- Payment tracking
- Online payment links
- Accounts receivable and overdue reminders
- Profit and stock valuation reporting
- User permissions
- Full business audit history

Instead of staff using spreadsheets, paper records, messages and separate systems, the goal is to bring these operations into one connected workflow.

---

## Two Locations, One Live System

The platform is designed around the two business locations:

### Lonsdale

All Lonsdale inventory, jobs, invoices, purchase orders, payments and stock activity are recorded against the Lonsdale location.

### Regency Park

Regency Park operates independently inside the same platform with its own stock quantities and operational records.

### Admin View

Admin can switch between:

- All Locations
- Lonsdale
- Regency Park

This gives management a live overview of the entire operation without losing branch-level detail.

Managers remain restricted to their assigned branch unless Admin changes their permissions.

---

## Advanced Tyre & Workshop Inventory

The system will manage:

- New truck tyres
- Used truck tyres
- Rims and wheels
- Tubes
- Valves
- Wheel nuts and studs
- Repair materials
- Balancing weights
- Workshop consumables
- Related truck tyre parts

Tyre records can include:

- Brand
- Size
- Pattern
- Load index
- Speed rating
- New or used condition
- Tread depth for used tyres
- Selling price
- Purchase cost
- Stock level
- Reorder quantity
- Supplier
- Location
- Notes and photos where required

Used tyres can be managed either as grouped stock or as individual tyres when their tread depth, condition or price differs.

---

## Accurate Stock Control

Every stock movement is recorded rather than simply changing a quantity on screen.

Examples include:

- Supplier delivery received
- Quick stock-in
- Customer sale
- Job usage
- Damaged stock
- Stock adjustment
- Customer return
- Supplier return
- Branch transfer dispatch
- Branch transfer receipt
- Stocktake correction

This creates a complete history showing **what changed, why it changed, who changed it and when**.

Negative stock is blocked so staff cannot accidentally sell or transfer inventory that the system does not have available.

---

## Automatic Inventory Cost & Profit Tracking

The system uses **Weighted Average Cost** for inventory valuation.

When stock is purchased at different prices, the software automatically recalculates the average cost for that product at that location.

This allows management to see:

- Inventory value
- Cost of goods sold
- Sales revenue
- Gross profit
- Gross margin
- Profit by product
- Profit by location
- Supplier purchase-cost trends

Historical invoices retain the cost that applied when the stock was sold, so future supplier price changes do not rewrite old profit figures.

---

## Smart Low-Stock & Reordering System

Each location can have its own minimum stock level and reorder quantity.

When stock becomes low, the system can show management:

- Current quantity
- Minimum quantity
- Suggested reorder quantity
- Preferred supplier
- Whether the other branch may have stock available

The software can help create a draft purchase order, but it will never order stock automatically without approval.

---

## Supplier & Purchase Order Management

Managers can prepare purchase orders for their own location.

The workflow is designed as:

**Manager Creates PO → Admin Reviews → Admin Approves → PO Sent to Supplier → Stock Received → Inventory Updated**

The software supports partial supplier deliveries, so if only part of an order arrives, the outstanding quantity remains open until the rest is received.

Supplier records can include:

- Contact information
- ABN
- Supplier account/reference
- Products supplied
- Last purchase cost
- Purchase history
- Total spend
- Open orders

This gives the business proper purchasing control instead of relying on informal ordering records.

---

## Lonsdale ↔ Regency Park Stock Transfers

Stock transfers are fully controlled and traceable.

The workflow is:

**Manager Requests Transfer → Admin Approves → Sending Branch Dispatches → Stock Is In Transit → Receiving Branch Confirms Receipt → Transfer Completed**

Stock does not magically appear in the other branch when a request is approved. It is recorded as **In Transit** until the receiving location confirms the physical delivery.

If the quantity received is different from the quantity dispatched, the system flags a discrepancy for Admin review.

---

## Customer & Fleet Account Management

The system supports both private customers and business/fleet customers.

Customer records can include:

- Name or company name
- ABN
- Contact details
- Billing address
- Multiple contacts
- Multiple trucks and trailers
- Registrations
- Fleet numbers
- Payment terms
- Quote history
- Job history
- Invoice history
- Payment history
- Outstanding balance

This gives the business a complete operational history for important transport and fleet customers.

---

## Quotes, Jobs & Workshop Operations

The platform will connect customer work from beginning to end.

Typical workflow:

**Customer → Quote → Job → Tyres/Parts Used → Labour → Invoice → Payment → Receipt**

Jobs can record:

- Customer
- Vehicle registration
- Truck/trailer information
- Work description
- Tyres and parts used
- Labour/service lines
- Job notes
- Manager responsible
- Location
- Photos where required

When stock is used on a job, inventory is updated automatically.

Accepted jobs can reserve stock so the same tyres are not accidentally allocated to another customer.

---

## POS & Counter Sales

Not every customer needs a full job record.

The software will also include a fast POS workflow for:

- Counter tyre sales
- Parts sales
- Quick workshop transactions
- Walk-in customers

Staff can quickly select products, add labour if required, take payment and issue a receipt or tax invoice.

---

## Professional Tax Invoicing

Each branch gets its own numbering sequence.

Examples:

- `LON-INV-000001`
- `REG-INV-000001`

The same branch structure applies to quotes, jobs, purchase orders and transfers.

Prices are GST-inclusive and the system automatically calculates the GST component.

Invoices can include:

- Customer details
- Products
- Labour
- Discounts where permitted
- GST
- Payment status
- Due date
- Branch details
- Professional PDF output

---

## Payments & Online Payment Links

The platform supports:

- Cash
- EFTPOS
- Bank transfer
- Online card payment
- Partial payments
- Split payments
- Refunds

Online invoice payments can be processed securely through Stripe.

The business system never stores raw card details.

After a successful online payment, the invoice can automatically update to Paid and a receipt can be issued.

---

## Business/Fleet Payment Terms & Receivables

Fleet and business customers can use approved terms such as:

- Due on receipt
- 7 days
- 14 days
- 30 days

The software tracks:

- Amount owing
- Due date
- Partially paid invoices
- Overdue invoices
- Customer account balance
- Accounts receivable

Automatic email reminders are planned for:

- 3 days before due date
- Due date
- 7 days overdue
- 14 days overdue

Reminders stop automatically once the invoice is fully paid.

---

## Admin & Manager Security

The system has two main user levels:

### Admin

Admin controls the complete platform and both locations.

### Manager

Managers are assigned to one location.

Admin can separately control permissions such as:

- Stock In
- Stock Out
- Stock adjustments
- View purchase cost
- Edit prices
- Create purchase orders
- Receive supplier orders
- Create quotes
- Create jobs
- Create invoices
- Record payments
- Apply discounts
- Issue refunds
- View reports
- Export reports

Location access itself remains protected so a branch manager cannot simply open another branch's confidential records.

---

## Full Audit Trail

Important activity is permanently recorded.

Examples:

- Stock adjusted
- Product price changed
- Purchase order approved
- Transfer approved
- Transfer dispatched
- Transfer received
- Invoice edited
- Discount applied
- Refund processed
- User permission changed

The log records who performed the action, when it happened, which location was involved and what changed.

This provides management accountability and makes operational problems much easier to investigate.

---

## Management Reporting

The platform is designed to give management high-level and detailed reporting, including:

- Sales by location
- Combined business sales
- Stock valuation
- Gross profit
- Gross margin
- GST totals
- Top-selling tyres
- Slow-moving stock
- Low-stock products
- Supplier spending
- Purchase-price history
- Outstanding invoices
- Overdue accounts
- Payment method totals
- Job activity
- Stock adjustments
- Branch transfer history
- Transfer discrepancies

Admin can compare Lonsdale and Regency Park from the same dashboard.

---

## Mobile + PC Operation

The system is being designed for actual day-to-day workshop use.

### PC

The desktop interface will provide:

- Large inventory tables
- Fast search and filtering
- Admin dashboards
- POS screens
- Purchasing
- Reporting
- User management

### Mobile

The mobile interface will focus on fast actions:

- Search stock
- Stock In
- Stock Out
- Create a job
- Add job parts
- Create invoice
- Record payment
- Request transfer
- Receive transfer
- Check low stock

The software can be installed as a **Progressive Web App (PWA)** so staff can open it like a normal application on supported PCs and phones.

---

## Data Safety & Business Reliability

This is being designed as a proper business system rather than a simple website form.

Important operations such as receiving stock, completing jobs and transferring inventory will use database transactions.

For example, the software will not allow a job to say Completed while failing to remove the tyres used on that job. The entire operation must succeed together or fail together.

Other protections include:

- Secure user authentication
- Database-level branch access rules
- No negative stock
- Duplicate-operation protection
- Immutable audit history
- Protected financial history
- Cloud database backups
- Staging before production changes
- Automated tests for critical stock and payment workflows

---

## Development Scope

Because of the size of the platform, development is structured into major phases rather than trying to build everything at once.

### Phase 1 — Inventory Foundation

Authentication, locations, permissions, PC/mobile application shell, products, new/used tyres, stock ledger, Stock In/Out, adjustments, weighted-average costing and low-stock management.

### Phase 2 — Purchasing & Transfers

Suppliers, purchase orders, Admin approval, goods receiving, smart reordering, stocktake and Lonsdale/Regency Park transfers.

### Phase 3 — Customers & Jobs

Individual customers, fleet/business accounts, vehicles, quotes, jobs and POS workflows.

### Phase 4 — Invoicing & Payments

Tax invoices, payment terms, EFTPOS/cash/bank payments, Stripe online payments, refunds, receipts, email delivery and overdue reminders.

### Phase 5 — Management Reporting & Production Polish

Financial and operational reports, exports, audit dashboards, PWA installation, performance optimisation, production testing and final business handover.

---

## Business Value

The main value is not simply knowing how many tyres are on the shelf.

The platform is intended to give 24/7 Truck Tyre Services a **central operational system** where stock, purchasing, jobs, customers, sales and management data all connect together.

It should help the business:

- Know exactly what stock is available at each branch.
- Reduce lost or unexplained inventory.
- Avoid selling stock that is not available.
- Improve purchasing decisions.
- See what products are moving and what stock is sitting too long.
- Track supplier costs over time.
- Control stock transfers between branches.
- Keep complete customer and fleet histories.
- Speed up workshop and counter sales.
- Track unpaid business accounts.
- Understand actual product profitability.
- Give managers the tools they need without giving them unrestricted access.
- Give ownership a real-time view of both locations from one dashboard.
- Create a strong operational foundation for future business expansion.

## Overall

This is a **large custom business software project**, not a basic inventory spreadsheet or simple stock app.

It combines inventory control, multi-branch operations, purchasing, workshop workflow, customer management, POS, invoicing, payments, profitability and reporting into one connected platform designed around how 24/7 Truck Tyre Services operates.

Once fully implemented, it can become one of the business's core day-to-day operating systems and can be expanded later as the company grows.
