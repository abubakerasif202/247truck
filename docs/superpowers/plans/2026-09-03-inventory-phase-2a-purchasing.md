# Inventory Phase 2A — Purchasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add supplier management, purchase orders, Admin approval, partial goods receiving, location-specific preferred suppliers, and smart low-stock-to-draft-PO workflows without weakening Phase 1 stock integrity or branch isolation.

**Architecture:** Extend the existing standalone `inventory-app/` only. Purchasing writes are database-authoritative through SECURITY DEFINER RPCs with explicit role/permission checks, RLS, append-only inventory movements, actor+location idempotency, and audit events. The purchasing UI uses server pages/actions and the existing responsive shell; receiving reuses the Phase 1 inventory ledger/WAC transaction path rather than maintaining a second stock implementation.

**Tech Stack:** Node.js 22.x, Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Supabase PostgreSQL/Auth, Vitest, Playwright, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-02-inventory-software-design.md`

## Global Constraints

- Inventory software stays isolated under `inventory-app/`; do not modify public marketing behavior.
- Initial locations remain Lonsdale (`LON`) and Regency Park (`REG`).
- Managers remain locked to exactly one location at the database and server layers.
- Only Admin may approve/reject purchase orders in v1; this must not become a grantable Manager permission.
- Manager purchasing permissions added in this phase: `purchasing.view`, `purchasing.create_po`, `purchasing.submit_po`, `purchasing.receive_po`.
- Existing `inventory.stock_in` continues to control Quick Stock-In; PO receiving uses `purchasing.receive_po`.
- Partial receipts are supported; over-receiving is blocked transactionally.
- Purchase receipt stock changes must use the existing append-only movement ledger and location-specific WAC calculation.
- No raw cost-bearing base-table access may be exposed to Managers without `inventory.view_cost`.
- All SECURITY DEFINER functions use `set search_path = ''`, fully-qualified object names, least-privilege EXECUTE grants, and explicit authorization.
- All critical mutations are idempotent and auditable.
- No production Supabase migration or production data mutation during implementation/review; production rollout is a separate approved step after merge.
- No barcode/QR scanning, automatic supplier ordering, transfers, customer/jobs/POS, invoicing, Stripe, or stocktake implementation in Phase 2A.

## Phase 2 decomposition

This plan intentionally implements **Phase 2A — Purchasing** only. The approved Phase 2 design contains independent transaction-heavy subsystems and is split to keep review and rollback boundaries safe:

1. **Phase 2A (this plan):** Suppliers, Purchase Orders, approval, receiving, preferred suppliers, smart reorder.
2. **Phase 2B:** Lonsdale ↔ Regency Park transfers including dispatch, in-transit, receipt, discrepancies and Admin resolution.
3. **Phase 2C:** Full-location stocktake with save-progress, variance review and atomic posting.

---

## File Structure

### Database

- Create `inventory-app/supabase/migrations/20260903090000_purchasing_permissions_suppliers.sql`
  - Extend Manager permission constraint and seed/update permission definitions.
  - Create `suppliers`, `product_suppliers`.
  - Add `preferred_supplier_id` to `inventory_settings`.
  - RLS, grants, indexes, audit-safe supplier RPCs.
- Create `inventory-app/supabase/migrations/20260903091000_purchase_orders.sql`
  - Create reusable `document_sequences`.
  - Create `purchase_orders`, `purchase_order_lines`.
  - Atomic location-prefixed PO numbering and PO mutation/status RPCs.
- Create `inventory-app/supabase/migrations/20260903092000_goods_receiving.sql`
  - Create `goods_receipts`, `goods_receipt_lines`.
  - Extend ledger movement type to `purchase_receipt`.
  - Add atomic `receive_purchase_order(...)` transaction.
- Create `inventory-app/supabase/migrations/20260903093000_smart_reordering.sql`
  - Safe preferred-supplier/settings mutation RPC.
  - Low-stock reorder projection and draft-PO generation RPC.

### Auth / domain

- Modify `inventory-app/lib/auth/types.ts`
- Modify `inventory-app/lib/auth/permission-keys.ts`
- Create `inventory-app/lib/purchasing/types.ts`
- Create `inventory-app/lib/purchasing/validation.ts`
- Create `inventory-app/lib/purchasing/queries.ts`
- Create `inventory-app/lib/purchasing/errors.ts`

### UI / server actions

- Create `inventory-app/app/(protected)/purchasing/suppliers/page.tsx`
- Create `inventory-app/app/(protected)/purchasing/suppliers/actions.ts`
- Create `inventory-app/app/(protected)/purchasing/purchase-orders/page.tsx`
- Create `inventory-app/app/(protected)/purchasing/purchase-orders/new/page.tsx`
- Create `inventory-app/app/(protected)/purchasing/purchase-orders/[id]/page.tsx`
- Create `inventory-app/app/(protected)/purchasing/purchase-orders/actions.ts`
- Create `inventory-app/app/(protected)/purchasing/purchase-orders/[id]/receive/page.tsx`
- Create `inventory-app/app/(protected)/purchasing/reorder/page.tsx`
- Create `inventory-app/components/purchasing/supplier-form.tsx`
- Create `inventory-app/components/purchasing/purchase-order-form.tsx`
- Create `inventory-app/components/purchasing/purchase-order-actions.tsx`
- Create `inventory-app/components/purchasing/receive-purchase-order-form.tsx`
- Create `inventory-app/components/purchasing/reorder-table.tsx`
- Modify `inventory-app/components/shell/nav.ts`
- Modify `inventory-app/app/(protected)/dashboard/page.tsx`

### Tests

- Modify `inventory-app/tests/unit/permissions.test.ts`
- Create `inventory-app/tests/unit/purchasing-validation.test.ts`
- Create `inventory-app/tests/unit/purchasing-navigation.test.ts`
- Create `inventory-app/tests/integration/purchasing-security.test.ts`
- Create `inventory-app/tests/integration/purchase-order-workflow.test.ts`
- Create `inventory-app/tests/integration/goods-receiving.test.ts`
- Create `inventory-app/tests/integration/smart-reordering.test.ts`
- Create `inventory-app/tests/e2e/purchasing.spec.ts`

### Docs

- Modify `docs/superpowers/progress/2026-09-02-inventory-phase-1.md` only to point readers to the Phase 2A plan/branch after implementation starts; do not rewrite Phase 1 history.
- Create `docs/inventory-phase-2a-deployment.md` at final rollout task.

---

### Task 1: Purchasing permissions and supplier database foundation

**Files:**
- Create: `inventory-app/supabase/migrations/20260903090000_purchasing_permissions_suppliers.sql`
- Modify: `inventory-app/lib/auth/types.ts`
- Modify: `inventory-app/lib/auth/permission-keys.ts`
- Modify: `inventory-app/tests/unit/permissions.test.ts`
- Create: `inventory-app/tests/integration/purchasing-security.test.ts`

**Interfaces:**
- Produces `PermissionKey` values: `purchasing.view`, `purchasing.create_po`, `purchasing.submit_po`, `purchasing.receive_po`.
- Produces tables `public.suppliers`, `public.product_suppliers`, and `public.inventory_settings.preferred_supplier_id`.
- Produces Admin-only RPCs `public.create_supplier(...)`, `public.update_supplier(...)`, `public.set_supplier_active(uuid, boolean)`.

- [ ] **Step 1: Write failing unit coverage for new permissions**

Add assertions that Manager grantable permissions include the four purchasing keys and that approval is not represented as a `PermissionKey`.

```ts
expect(MANAGER_GRANTABLE_PERMISSIONS).toEqual(
  expect.arrayContaining([
    'purchasing.view',
    'purchasing.create_po',
    'purchasing.submit_po',
    'purchasing.receive_po',
  ]),
);
expect(MANAGER_GRANTABLE_PERMISSIONS).not.toContain('purchasing.approve_po');
```

- [ ] **Step 2: Run the focused permission test and verify RED**

Run:

```bash
cd inventory-app
npm run test:unit -- tests/unit/permissions.test.ts
```

Expected: FAIL because the new keys do not exist yet.

- [ ] **Step 3: Extend TypeScript permission contracts**

Update `lib/auth/types.ts`:

```ts
export type PermissionKey =
  | 'inventory.view'
  | 'inventory.stock_in'
  | 'inventory.stock_out'
  | 'inventory.adjust'
  | 'inventory.view_cost'
  | 'inventory.edit_global_price'
  | 'purchasing.view'
  | 'purchasing.create_po'
  | 'purchasing.submit_po'
  | 'purchasing.receive_po'
  | 'reports.view_inventory_value';
```

Update `MANAGER_GRANTABLE_PERMISSIONS` and labels with exactly:

```ts
'purchasing.view': 'View purchasing',
'purchasing.create_po': 'Create purchase orders',
'purchasing.submit_po': 'Submit purchase orders',
'purchasing.receive_po': 'Receive purchase orders',
```

- [ ] **Step 4: Write supplier security integration tests before migration**

Cover these exact cases:

```ts
it('manager can read active suppliers when purchasing.view is enabled');
it('manager cannot insert/update/delete supplier base rows directly');
it('manager cannot execute Admin supplier mutation RPCs');
it('admin can create/update/archive suppliers through RPCs');
it('manager sees only their own inventory_settings row including preferred supplier');
it('authenticated users cannot read supplier last_cost without inventory.view_cost');
```

- [ ] **Step 5: Run integration test and verify RED**

Run with local Supabase test env:

```bash
npm run test:integration -- tests/integration/purchasing-security.test.ts
```

Expected: FAIL because supplier schema and permissions do not exist.

- [ ] **Step 6: Implement supplier migration**

Core schema:

```sql
create table public.suppliers (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  abn text,
  contact_name text,
  phone text,
  email text,
  address text,
  payment_terms text,
  account_reference text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_suppliers (
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  supplier_sku text,
  last_cost numeric(14,4) check (last_cost is null or last_cost >= 0),
  typical_lead_days integer check (typical_lead_days is null or typical_lead_days >= 0),
  minimum_order_qty integer not null default 1 check (minimum_order_qty > 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, supplier_id)
);

alter table public.inventory_settings
  add column preferred_supplier_id uuid references public.suppliers(id);
```

Extend the Manager permission CHECK by dropping/recreating `manager_permissions_permission_key_check` with the Phase 1 keys plus the four purchasing keys. Keep approval out of the list.

Supplier base-table writes remain unavailable to `authenticated`; Admin mutations occur only through SECURITY DEFINER RPCs. Give authenticated users safe supplier metadata SELECT while withholding `product_suppliers.last_cost` from direct grants. Cost-aware supplier-product data must be served through a permission-gated RPC/view later in Task 3.

- [ ] **Step 7: Verify grants/RLS and indexes**

Required indexes:

```sql
create index suppliers_active_name_idx on public.suppliers (active, lower(name));
create index product_suppliers_supplier_idx on public.product_suppliers (supplier_id);
create index inventory_settings_preferred_supplier_idx
  on public.inventory_settings (preferred_supplier_id);
```

Every policy must use cached helper calls such as `(select private.app_is_admin())` and `(select private.app_user_location_id())`.

- [ ] **Step 8: Run focused tests GREEN**

```bash
npm run test:unit -- tests/unit/permissions.test.ts
npm run test:integration -- tests/integration/purchasing-security.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add inventory-app/lib/auth inventory-app/supabase/migrations/20260903090000_purchasing_permissions_suppliers.sql inventory-app/tests/unit/permissions.test.ts inventory-app/tests/integration/purchasing-security.test.ts
git commit -m "feat(inventory): add purchasing permissions and suppliers"
```

---

### Task 2: Supplier domain validation, queries and Admin UI

**Files:**
- Create: `inventory-app/lib/purchasing/types.ts`
- Create: `inventory-app/lib/purchasing/validation.ts`
- Create: `inventory-app/lib/purchasing/errors.ts`
- Create: `inventory-app/lib/purchasing/queries.ts`
- Create: `inventory-app/app/(protected)/purchasing/suppliers/page.tsx`
- Create: `inventory-app/app/(protected)/purchasing/suppliers/actions.ts`
- Create: `inventory-app/components/purchasing/supplier-form.tsx`
- Create: `inventory-app/tests/unit/purchasing-validation.test.ts`

**Interfaces:**

```ts
export type SupplierInput = {
  name: string;
  abn: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  accountReference: string | null;
  notes: string | null;
};

export type SupplierSummary = SupplierInput & {
  id: string;
  active: boolean;
};

export function parseSupplierInput(formData: FormData): SupplierInput;
export async function listSuppliers(client: SupabaseClient, includeInactive?: boolean): Promise<SupplierSummary[]>;
```

- [ ] **Step 1: Write validation tests RED**

Test blank name rejection, trimmed values, email normalization, empty strings → `null`, and maximum practical text lengths.

```ts
expect(() => parseSupplierInput(fd({ name: '   ' }))).toThrow('Supplier name is required.');
expect(parseSupplierInput(fd({ name: '  Bridgestone  ', email: ' SALES@EXAMPLE.COM ' })).name).toBe('Bridgestone');
```

- [ ] **Step 2: Implement `parseSupplierInput` minimally**

Use a small helper:

```ts
const optional = (value: FormDataEntryValue | null) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? null : text;
};
```

Reject names longer than 160 chars and optional fields longer than 500 chars; notes/address may be 2000 chars.

- [ ] **Step 3: Run unit test GREEN**

```bash
npm run test:unit -- tests/unit/purchasing-validation.test.ts
```

- [ ] **Step 4: Implement supplier queries and error mapping**

`mapPurchasingRpcError` maps DB codes/messages to stable UI messages:

```ts
const messages: Record<string, string> = {
  ACCESS_DENIED: 'You do not have permission to perform this action.',
  SUPPLIER_NOT_FOUND: 'Supplier not found.',
};
```

- [ ] **Step 5: Implement Admin supplier actions**

Actions must call `getCurrentAccess()`, require `access.role === 'admin'`, parse input, call the supplier RPC, and `revalidatePath('/purchasing/suppliers')`.

- [ ] **Step 6: Implement responsive supplier page/form**

Desktop: searchable table with Name, Contact, Phone, Email, Account Ref, Active. Mobile: stacked cards. Supplier create/edit/archive controls are Admin-only. Managers with `purchasing.view` may read active suppliers but do not see mutation controls.

- [ ] **Step 7: Add render/permission tests and run full unit suite**

```bash
npm run test:unit
```

- [ ] **Step 8: Commit**

```bash
git add inventory-app/lib/purchasing inventory-app/app/'(protected)'/purchasing/suppliers inventory-app/components/purchasing/supplier-form.tsx inventory-app/tests/unit
git commit -m "feat(inventory): add supplier management"
```

---

### Task 3: Purchase-order schema, numbering and cost-safe reads

**Files:**
- Create: `inventory-app/supabase/migrations/20260903091000_purchase_orders.sql`
- Extend: `inventory-app/lib/purchasing/types.ts`
- Extend: `inventory-app/tests/integration/purchasing-security.test.ts`
- Create: `inventory-app/tests/integration/purchase-order-workflow.test.ts`

**Interfaces:**

```ts
export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'rejected'
  | 'cancelled';
```

Database RPCs produced:

```sql
public.create_purchase_order(p_location_id uuid, p_supplier_id uuid, p_notes text, p_supplier_reference text) returns uuid
public.replace_purchase_order_lines(p_purchase_order_id uuid, p_lines jsonb) returns void
public.submit_purchase_order(p_purchase_order_id uuid) returns void
public.approve_purchase_order(p_purchase_order_id uuid) returns void
public.reject_purchase_order(p_purchase_order_id uuid, p_reason text) returns void
public.mark_purchase_order_sent(p_purchase_order_id uuid) returns void
public.cancel_purchase_order(p_purchase_order_id uuid, p_reason text) returns void
```

- [ ] **Step 1: Write PO workflow integration tests RED**

Cover:

```ts
it('manager creates draft PO only for assigned location');
it('manager cannot create PO for the other location');
it('draft receives an atomic LON-PO-000001/REG-PO-000001 number');
it('manager with create permission can edit only draft/rejected PO');
it('submit requires purchasing.submit_po');
it('only admin can approve or reject');
it('approval does not change inventory');
it('cannot edit lines after approval');
it('cost-bearing PO lines are hidden from managers without inventory.view_cost');
it('all status changes create audit events');
```

- [ ] **Step 2: Create reusable location document sequence**

```sql
create table public.document_sequences (
  location_id uuid not null references public.locations(id),
  document_type text not null,
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (location_id, document_type)
);
```

`private.next_location_document_number(uuid,text,text)` locks/upserts the row and returns `CODE-TYPE-000001`. For POs, use location `code` plus literal `PO`.

- [ ] **Step 3: Create PO tables**

```sql
create table public.purchase_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  supplier_id uuid not null references public.suppliers(id),
  po_number text not null unique,
  status text not null default 'draft' check (status in (
    'draft','submitted','approved','sent','partially_received','received','closed','rejected','cancelled'
  )),
  supplier_reference text,
  notes text,
  rejection_reason text,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  submitted_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  rejected_by uuid references auth.users(id),
  sent_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  sent_at timestamptz,
  closed_at timestamptz
);

create table public.purchase_order_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  description_snapshot text not null,
  supplier_sku_snapshot text,
  ordered_quantity integer not null check (ordered_quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  received_quantity integer not null default 0 check (received_quantity >= 0),
  notes text,
  unique (purchase_order_id, product_id)
);
```

Add indexes for `(location_id,status,created_at desc)`, `(supplier_id,status)`, and PO line `product_id`.

- [ ] **Step 4: Implement DB authorization/status transitions**

Manager create/edit/submit functions must require the specific Manager permission and force `location_id = private.app_user_location_id()`. Admin may operate both locations. Approve/reject checks role directly through `private.app_is_admin()` and never checks a grantable permission.

- [ ] **Step 5: Implement cost-safe read interface**

Provide `public.purchase_order_summary(...)` / `public.purchase_order_detail(...)` RPCs (or equivalent security-invoker views plus a cost-gated RPC) so `unit_cost` is returned as NULL when `private.app_has_permission('inventory.view_cost')` is false. Never grant authenticated users raw SELECT of cost-bearing PO line columns.

- [ ] **Step 6: Run integration tests GREEN**

```bash
npm run test:integration -- tests/integration/purchase-order-workflow.test.ts tests/integration/purchasing-security.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add inventory-app/supabase/migrations/20260903091000_purchase_orders.sql inventory-app/lib/purchasing/types.ts inventory-app/tests/integration
git commit -m "feat(inventory): add purchase order workflow"
```

---

### Task 4: Purchase-order application pages and actions

**Files:**
- Extend: `inventory-app/lib/purchasing/validation.ts`
- Extend: `inventory-app/lib/purchasing/queries.ts`
- Create: `inventory-app/app/(protected)/purchasing/purchase-orders/page.tsx`
- Create: `inventory-app/app/(protected)/purchasing/purchase-orders/new/page.tsx`
- Create: `inventory-app/app/(protected)/purchasing/purchase-orders/[id]/page.tsx`
- Create: `inventory-app/app/(protected)/purchasing/purchase-orders/actions.ts`
- Create: `inventory-app/components/purchasing/purchase-order-form.tsx`
- Create: `inventory-app/components/purchasing/purchase-order-actions.tsx`
- Extend: `inventory-app/tests/unit/purchasing-validation.test.ts`

**Interfaces:**

```ts
export type PurchaseOrderLineInput = {
  productId: string;
  orderedQuantity: number;
  unitCost: number;
  notes: string | null;
};

export type PurchaseOrderDraftInput = {
  locationId: string;
  supplierId: string;
  supplierReference: string | null;
  notes: string | null;
  lines: PurchaseOrderLineInput[];
};
```

- [ ] **Step 1: Write PO validation tests RED**

Reject zero lines, duplicate product IDs, quantity < 1, negative/non-finite costs, blank supplier/location IDs, and values with >4 cost decimal places.

- [ ] **Step 2: Implement `parsePurchaseOrderDraft` and run GREEN**

```bash
npm run test:unit -- tests/unit/purchasing-validation.test.ts
```

- [ ] **Step 3: Implement queries**

List supports `status`, `supplierId`, and current resolved location scope. Detail returns PO header + lines + permissions-derived action flags.

- [ ] **Step 4: Implement create/save/submit/Admin decision actions**

Each action must:

```ts
const access = await getCurrentAccess();
const supabase = await createServerSupabaseClient();
// validate input -> call one DB RPC -> map safe error -> revalidatePath
```

Do not use service-role clients for ordinary authenticated PO mutations.

- [ ] **Step 5: Build PO list/new/detail UI**

Desktop list columns: PO Number, Supplier, Location, Status, Created, Ordered Total (cost permission gated), Outstanding. Mobile uses cards. Detail page shows immutable status history timestamps and buttons only for legal transitions.

- [ ] **Step 6: Add page/action unit coverage**

Assert Managers cannot see Approve/Reject controls and Admin can. Assert cost is omitted when access lacks `inventory.view_cost`.

- [ ] **Step 7: Run unit + typecheck**

```bash
npm run test:unit
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add inventory-app/lib/purchasing inventory-app/app/'(protected)'/purchasing/purchase-orders inventory-app/components/purchasing inventory-app/tests/unit
git commit -m "feat(inventory): add purchase order screens"
```

---

### Task 5: Atomic partial goods receiving and WAC integration

**Files:**
- Create: `inventory-app/supabase/migrations/20260903092000_goods_receiving.sql`
- Create: `inventory-app/tests/integration/goods-receiving.test.ts`
- Extend: `inventory-app/lib/purchasing/types.ts`
- Extend: `inventory-app/lib/purchasing/validation.ts`

**Interfaces:**

```ts
export type ReceiptLineInput = {
  purchaseOrderLineId: string;
  quantityReceived: number;
};

public.receive_purchase_order(
  p_request_id uuid,
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_supplier_delivery_reference text default null,
  p_notes text default null
) returns uuid
```

- [ ] **Step 1: Write receiving integration tests RED**

Exact cases:

```ts
it('receives an approved PO and increases stock using line unit cost');
it('recalculates location WAC using the existing formula');
it('partial receipt leaves outstanding quantity and status partially_received');
it('final receipt changes status to received');
it('blocks receive-now quantity above outstanding');
it('blocks receive before approval');
it('manager cannot receive another branch PO');
it('manager requires purchasing.receive_po');
it('replayed request id does not double receive');
it('concurrent receives cannot over-receive');
it('goods receipt, inventory movements, balances and PO counters commit atomically');
```

- [ ] **Step 2: Extend ledger movement constraints safely**

Drop/recreate the movement type and direction constraints to include `purchase_receipt` as positive-only. Update `private.assert_stock_authorization`:

```sql
when 'purchase_receipt' then 'purchasing.receive_po'
```

Do not change existing Quick Stock-In authorization.

- [ ] **Step 3: Create receipt tables**

```sql
create table public.goods_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null,
  purchase_order_id uuid not null references public.purchase_orders(id),
  location_id uuid not null references public.locations(id),
  supplier_id uuid not null references public.suppliers(id),
  receipt_number text not null unique,
  supplier_delivery_reference text,
  notes text,
  received_by uuid not null references auth.users(id),
  received_at timestamptz not null default now(),
  unique (received_by, location_id, request_id)
);

create table public.goods_receipt_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id),
  product_id uuid not null references public.products(id),
  quantity_received integer not null check (quantity_received > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  inventory_movement_id uuid not null references public.inventory_movements(id)
);
```

Receipt number uses location prefix + `GRN` through the reusable document sequence.

- [ ] **Step 4: Implement one transaction in `receive_purchase_order`**

Lock in consistent order:

1. PO row `FOR UPDATE`.
2. Selected PO lines ordered by line UUID `FOR UPDATE`.
3. Existing `post_inventory_movement` handles product/location balance locking and WAC.

For each validated line call:

```sql
select movement_id
into v_movement_id
from public.post_inventory_movement(
  extensions.gen_random_uuid(),
  v_line.product_id,
  v_po.location_id,
  v_receive_qty,
  'purchase_receipt',
  'Purchase order receipt',
  v_line.unit_cost,
  null,
  'goods_receipt',
  v_receipt_id::text,
  v_supplier_name
);
```

The outer request id guards the receiving event. Inner movement request IDs are generated inside the already-idempotent outer transaction so a replay returns the existing receipt before any inner calls occur.

- [ ] **Step 5: Update `product_suppliers.last_cost` only after successful receipt**

Use line unit cost and `ON CONFLICT (product_id,supplier_id) DO UPDATE`. This table remains cost-gated.

- [ ] **Step 6: Verify RED→GREEN including concurrency**

```bash
npm run test:integration -- tests/integration/goods-receiving.test.ts
```

- [ ] **Step 7: Run Phase 1 inventory security tests unchanged**

```bash
npm run test:integration -- tests/integration/inventory-security-hardening.test.ts
```

Expected: PASS; purchasing must not reopen direct cost reads, cross-branch replay disclosure, negative stock, or ledger mutation.

- [ ] **Step 8: Commit**

```bash
git add inventory-app/supabase/migrations/20260903092000_goods_receiving.sql inventory-app/tests/integration/goods-receiving.test.ts inventory-app/lib/purchasing
git commit -m "feat(inventory): add atomic purchase receiving"
```

---

### Task 6: Receiving UI and PO outstanding-state UX

**Files:**
- Create: `inventory-app/app/(protected)/purchasing/purchase-orders/[id]/receive/page.tsx`
- Extend: `inventory-app/app/(protected)/purchasing/purchase-orders/actions.ts`
- Create: `inventory-app/components/purchasing/receive-purchase-order-form.tsx`
- Extend: `inventory-app/lib/purchasing/queries.ts`
- Extend: `inventory-app/tests/unit/purchasing-validation.test.ts`

**Interfaces:**

```ts
export type ReceivablePurchaseOrderLine = {
  id: string;
  productId: string;
  productName: string;
  orderedQuantity: number;
  previouslyReceived: number;
  outstandingQuantity: number;
  unitCost: number | null;
};
```

- [ ] **Step 1: Add receipt input validation tests RED**

At least one line must have `receiveNow > 0`; each value must be an integer `0..outstandingQuantity`.

- [ ] **Step 2: Implement receipt parser GREEN**

Use server-authoritative outstanding validation again inside the DB RPC; UI validation is convenience only.

- [ ] **Step 3: Build receive page/form**

Show Ordered, Previously Received, Receive Now, Outstanding. Cost is shown only when `inventory.view_cost` permits. Disable rows with zero outstanding.

- [ ] **Step 4: Implement receive server action**

Generate a new `crypto.randomUUID()` request id per submitted receiving event and call `receive_purchase_order`. On success redirect to PO detail with `?received=1`.

- [ ] **Step 5: Run unit/typecheck/build**

```bash
npm run test:unit
npm run typecheck
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add inventory-app/app/'(protected)'/purchasing/purchase-orders inventory-app/components/purchasing/receive-purchase-order-form.tsx inventory-app/lib/purchasing inventory-app/tests/unit
git commit -m "feat(inventory): add purchase receiving UI"
```

---

### Task 7: Preferred suppliers and smart low-stock → draft PO

**Files:**
- Create: `inventory-app/supabase/migrations/20260903093000_smart_reordering.sql`
- Create: `inventory-app/tests/integration/smart-reordering.test.ts`
- Create: `inventory-app/app/(protected)/purchasing/reorder/page.tsx`
- Create: `inventory-app/components/purchasing/reorder-table.tsx`
- Extend: `inventory-app/app/(protected)/purchasing/purchase-orders/actions.ts`
- Extend: `inventory-app/lib/purchasing/queries.ts`

**Interfaces:**

```ts
export type ReorderSuggestion = {
  productId: string;
  productName: string;
  locationCode: 'LON' | 'REG';
  available: number;
  minimumStock: number;
  reorderQuantity: number;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
};
```

RPCs:

```sql
public.set_inventory_reorder_settings(
  p_product_id uuid,
  p_location_id uuid,
  p_minimum_stock integer,
  p_reorder_quantity integer,
  p_preferred_supplier_id uuid default null
) returns void

public.create_draft_purchase_orders_from_reorder(
  p_location_id uuid,
  p_product_ids uuid[]
) returns setof uuid
```

- [ ] **Step 1: Write smart-reorder integration tests RED**

Cover own-location Manager restriction, negative threshold rejection, inactive supplier rejection, low-stock selection only, no automatic PO without explicit action, grouping by preferred supplier, and omission of products with no preferred supplier from automatic draft generation.

- [ ] **Step 2: Implement settings mutation authorization**

Managers require `purchasing.create_po` and may alter only their own branch reorder settings; Admin may alter either branch. Preferred supplier must be active and associated through `product_suppliers` for that product.

- [ ] **Step 3: Implement reorder projection**

Use `inventory_product_summary` + `inventory_settings` + supplier safe metadata. A suggestion exists only when `available < minimum_stock` and `reorder_quantity > 0`.

- [ ] **Step 4: Implement explicit draft generation**

Group selected products by preferred supplier and create one draft PO per supplier for the current location. Quantities use configured `reorder_quantity`, increased to `minimum_order_qty` when the product-supplier minimum is higher. No automatic submission/approval/sending.

- [ ] **Step 5: Build reorder page**

Desktop table/mobile cards with selectable rows, preferred supplier, available/minimum/reorder qty, and `Create draft POs` button. Rows without a preferred supplier display `Set preferred supplier` and are not selectable for generation.

- [ ] **Step 6: Run integration + unit GREEN**

```bash
npm run test:integration -- tests/integration/smart-reordering.test.ts
npm run test:unit
```

- [ ] **Step 7: Commit**

```bash
git add inventory-app/supabase/migrations/20260903093000_smart_reordering.sql inventory-app/tests/integration/smart-reordering.test.ts inventory-app/app/'(protected)'/purchasing/reorder inventory-app/components/purchasing/reorder-table.tsx inventory-app/lib/purchasing inventory-app/app/'(protected)'/purchasing/purchase-orders/actions.ts
git commit -m "feat(inventory): add smart purchasing reorder flow"
```

---

### Task 8: Navigation and dashboard purchasing status

**Files:**
- Modify: `inventory-app/components/shell/nav.ts`
- Modify: `inventory-app/tests/unit/shell-navigation.test.tsx`
- Create: `inventory-app/tests/unit/purchasing-navigation.test.ts`
- Modify: `inventory-app/app/(protected)/dashboard/page.tsx`
- Extend: `inventory-app/lib/purchasing/queries.ts`

**Interfaces:**

```ts
export type PurchasingDashboardCounts = {
  pendingApproval: number;
  approvedAwaitingReceipt: number;
};
```

- [ ] **Step 1: Write nav/dashboard tests RED**

Expected desktop purchasing item:

```ts
{ href: '/purchasing/purchase-orders', label: 'Purchasing', permission: 'purchasing.view', placement: 'more' }
```

Admin sees Purchasing regardless of permission set via existing `hasPermission` Admin semantics. Manager without `purchasing.view` does not.

- [ ] **Step 2: Implement nav item and keep `prefetch={false}` behavior through `NavLink`**

Do not add Purchasing to the four-item mobile bottom bar; it belongs in `More`.

- [ ] **Step 3: Add dashboard counts**

Admin dashboard: pending PO approvals, approved/sent/partial awaiting receipt. Manager dashboard: own-location submitted/approved/sent/partial counts only.

- [ ] **Step 4: Run shell + dashboard unit tests GREEN**

```bash
npm run test:unit
```

- [ ] **Step 5: Commit**

```bash
git add inventory-app/components/shell/nav.ts inventory-app/tests/unit inventory-app/app/'(protected)'/dashboard/page.tsx inventory-app/lib/purchasing/queries.ts
git commit -m "feat(inventory): surface purchasing in shell and dashboard"
```

---

### Task 9: End-to-end purchasing workflow, security regression and rollout docs

**Files:**
- Create: `inventory-app/tests/e2e/purchasing.spec.ts`
- Extend: `inventory-app/tests/integration/purchasing-security.test.ts`
- Create: `docs/inventory-phase-2a-deployment.md`
- Modify: `docs/superpowers/progress/2026-09-02-inventory-phase-1.md`

**Interfaces:**
- No new runtime interfaces; this task proves and documents the assembled Phase 2A contract.

- [ ] **Step 1: Write E2E flow before claiming completion**

Automate:

```text
Admin creates supplier
→ Manager creates LON draft PO
→ Manager submits
→ Admin approves
→ Manager receives a partial quantity
→ PO shows Partially Received and stock/WAC updated
→ Manager receives remainder
→ PO shows Received
→ low-stock suggestion disappears when available is no longer below minimum
```

Also cover Manager cannot select REG and cannot see Admin Approve/Reject controls.

- [ ] **Step 2: Run local Supabase reset and complete integration suite**

```bash
supabase start
supabase db reset
npm run test:integration
```

Expected: all Phase 1 + Phase 2A integration tests pass.

- [ ] **Step 3: Run Playwright E2E**

```bash
npx playwright install chromium
npm run test:e2e
```

Expected: all E2E tests pass.

- [ ] **Step 4: Run static verification**

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Re-run root public website verification**

From repository root:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The public website must remain unchanged and green.

- [ ] **Step 6: Security review checklist**

Verify manually from SQL/grants/tests:

```text
[ ] Manager cannot read another location's POs/receipts/settings.
[ ] Manager cannot approve/reject a PO by RPC, REST, crafted request, or direct table write.
[ ] Cost-bearing line data and supplier last cost are hidden without inventory.view_cost.
[ ] Goods receipt replay cannot duplicate stock.
[ ] Concurrent receipts cannot over-receive.
[ ] Purchase receipt uses existing WAC and ledger invariants.
[ ] inventory_movements remains append-only.
[ ] Every supplier/PO/receipt/status mutation writes audit history.
[ ] SECURITY DEFINER functions use empty search_path and explicit grants.
[ ] No service-role key reaches client bundles.
```

- [ ] **Step 7: Write deployment document**

`docs/inventory-phase-2a-deployment.md` must require:

```text
1. Back up/confirm target inventory Supabase project ref.
2. supabase db push --dry-run and confirm exactly the four Phase 2A migrations.
3. Apply only after explicit production approval.
4. Verify Manager permissions in Admin Users screen before granting.
5. Smoke test supplier → PO → approval → partial receipt → final receipt in production with a controlled test product.
6. Verify stock/WAC/audit rows, then remove/close the controlled test records per the documented safe path.
```

Never print or store service-role/database credentials in the document.

- [ ] **Step 8: Update progress pointer**

Append a short Phase 2A section to the existing progress document with branch name, plan path, task commit SHAs, verification results, and explicit note that Phase 2B Transfers and Phase 2C Stocktake remain unimplemented.

- [ ] **Step 9: Commit final tests/docs**

```bash
git add inventory-app/tests docs/inventory-phase-2a-deployment.md docs/superpowers/progress/2026-09-02-inventory-phase-1.md
git commit -m "test(inventory): verify phase 2a purchasing"
```

---

## Plan Self-Review

### Spec coverage for Phase 2A

- Supplier details: covered Tasks 1–2.
- Product-supplier SKU, last cost, lead time, MOQ: covered Tasks 1, 5, 7.
- Manager creates/submits own-location PO: covered Tasks 3–4.
- Admin-only approve/reject: covered Tasks 1, 3, 4, 9.
- Sent status: covered Tasks 3–4.
- Partial receiving and goods receipts: covered Tasks 5–6.
- Over-receive blocking and concurrency: covered Tasks 5, 9.
- WAC update from receipt: covered Task 5.
- Location-specific preferred supplier/reorder settings: covered Tasks 1, 7.
- Low-stock smart PO suggestions requiring explicit user action: covered Task 7.
- Dashboard pending approvals: covered Task 8.
- Audit/security/RLS/branch isolation: covered Tasks 1, 3, 5, 7, 9.
- Phase 2 Transfers: intentionally deferred to Phase 2B.
- Full stocktake: intentionally deferred to Phase 2C.

### Placeholder scan

No `TBD`, `TODO`, `implement later`, or undefined implementation placeholders are permitted in execution. Deferred features are explicitly out of Phase 2A scope rather than placeholders.

### Type/interface consistency

- `PermissionKey` names are identical across DB and TypeScript.
- PO statuses are identical in TypeScript and SQL.
- Goods receipt input uses PO line IDs and integer receive quantities.
- Cost visibility consistently keys off `inventory.view_cost`.
- Manager branch isolation consistently resolves from authenticated profile, not caller-provided location alone.
