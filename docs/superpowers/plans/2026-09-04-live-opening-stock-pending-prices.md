# Live Opening Stock with Pending Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client-supplied 53-line / 725-tyre opening stock list operational in the 24/7 Inventory app as New stock at Regency Park while Cost Price and Selling Price remain genuinely unknown, visible as pending, auditable, and assignable later without corrupting WAC or valuation.

**Architecture:** Keep the existing standalone `inventory-app/` and its append-only ledger. Add nullable product price/WAC support, a dedicated Admin-only `opening_stock` movement path, immutable opening-cost assignments with WAC reconstruction, a strict repository-backed source parser, an idempotent per-row import RPC, Admin preview/import UI, pending-price/cost presentation, and valuation reporting that separates known value from unvalued units. Normal Quick Stock-In and PO receiving remain cost-required and branch/RLS rules remain unchanged.

**Tech Stack:** Node 22.x, Next.js 16.3.3 App Router, React 19.2.6, TypeScript 5.9.3, Tailwind 4.2.1, shadcn/ui/Base UI, Supabase PostgreSQL/Auth, Zod 4.5.4, Vitest 4.1.11, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-04-live-opening-stock-pending-prices-design.md`

## Global Constraints

- The public marketing site at repository root must remain unchanged except for repository-wide tooling only when strictly required.
- `inventory-app/` remains a separate Next.js/Vercel/Supabase application.
- Confirmed source data is fixed: 53 rows, 725 tyres, all `New`, all `Regency Park`.
- Unknown Cost Price and Selling Price must remain `NULL`; never substitute `$0`.
- `0.00` remains a valid explicit known price/cost and must stay distinct from `NULL`.
- Opening-stock posting is Admin-only and must never write directly to `inventory_balances` outside an approved SECURITY DEFINER database transaction.
- Normal `quick_stock_in`, used-unit intake, and PO receiving retain their existing requirement for known non-negative cost.
- Inventory movements remain append-only; later cost assignment must not update or delete the original opening-stock movement.
- Branch isolation remains server-enforced: Regency Park Managers see Regency Park only; Lonsdale Managers do not gain access to Regency Park.
- Existing `inventory.view_cost`, `inventory.edit_global_price`, and `reports.view_inventory_value` permissions remain the authorization primitives for cost visibility, global price editing, and valuation visibility.
- Every SECURITY DEFINER function uses `set search_path = ''` and explicit grants/revokes.
- All database integration work is verified against the local/disposable Supabase project before any production migration or import.
- Never reset, truncate, or delete production stock as part of this change.
- Follow `inventory-app/AGENTS.md`: before changing Next.js runtime/config behavior, read the relevant local Next 16 documentation under `node_modules/next/dist/docs/`.

---

## File Map

### New database migrations

- `inventory-app/supabase/migrations/20260904150000_pending_financials.sql` — nullable product price/WAC/cost snapshot, zero-balance WAC normalization, nullable-aware product creation, audited global price setter.
- `inventory-app/supabase/migrations/20260904151000_opening_stock.sql` — `opening_stock` movement type, Admin-only posting RPC, generic-RPC guard.
- `inventory-app/supabase/migrations/20260904152000_opening_stock_costs.sql` — immutable opening-cost assignment table, pending-cost query RPC, chronological WAC reconstruction, Admin assignment RPC.
- `inventory-app/supabase/migrations/20260904153000_pending_valuation.sql` — known-value + unvalued-units valuation RPC.
- `inventory-app/supabase/migrations/20260904154000_opening_stock_import.sql` — per-row import evidence table and atomic/idempotent import-row RPC.

### New application modules

- `inventory-app/lib/opening-stock/types.ts`
- `inventory-app/lib/opening-stock/parse.ts`
- `inventory-app/lib/opening-stock/source.ts`
- `inventory-app/lib/opening-stock/repository.ts`
- `inventory-app/app/(protected)/inventory/import/page.tsx`
- `inventory-app/app/(protected)/inventory/import/actions.ts`
- `inventory-app/components/inventory/opening-stock-import-panel.tsx`
- `inventory-app/components/inventory/set-selling-price-form.tsx`
- `inventory-app/components/inventory/assign-opening-cost-form.tsx`

### Existing files to modify

- `inventory-app/lib/products/types.ts`
- `inventory-app/lib/products/validation.ts`
- `inventory-app/lib/products/repository.ts`
- `inventory-app/lib/inventory/types.ts`
- `inventory-app/lib/inventory/repository.ts`
- `inventory-app/lib/inventory/queries.ts`
- `inventory-app/lib/format.ts`
- `inventory-app/app/(protected)/inventory/actions.ts`
- `inventory-app/app/(protected)/inventory/page.tsx`
- `inventory-app/app/(protected)/inventory/[productId]/page.tsx`
- `inventory-app/components/inventory/product-form.tsx`
- `inventory-app/components/inventory/inventory-view.tsx`
- `inventory-app/app/(protected)/dashboard/page.tsx`
- `inventory-app/README.md`
- `inventory-app/data/README.md`
- `docs/superpowers/specs/2026-09-04-live-opening-stock-pending-prices-design.md`

### Tests to add/modify

- Modify `inventory-app/tests/unit/product-validation.test.ts`
- Keep and extend `inventory-app/tests/unit/stock-validation.test.ts`
- Add `inventory-app/tests/unit/opening-stock-parse.test.ts`
- Add `inventory-app/tests/unit/pending-financial-display.test.tsx`
- Add `inventory-app/tests/unit/opening-stock-import-panel.test.tsx`
- Add `inventory-app/tests/integration/opening-stock.test.ts`
- Extend `inventory-app/tests/integration/product-rls.test.ts`
- Extend `inventory-app/tests/integration/inventory-summary.test.ts`
- Extend `inventory-app/tests/integration/inventory-security-hardening.test.ts`
- Add `inventory-app/tests/e2e/opening-stock.spec.ts`

---

## Task 1: Make Product Price and Inventory WAC Nullable Without Changing Normal Stock Rules

**Files:**
- Create `inventory-app/supabase/migrations/20260904150000_pending_financials.sql`
- Modify `inventory-app/lib/products/types.ts`
- Modify `inventory-app/lib/products/validation.ts`
- Modify `inventory-app/lib/products/repository.ts`
- Modify `inventory-app/components/inventory/product-form.tsx`
- Modify `inventory-app/tests/unit/product-validation.test.ts`
- Modify `inventory-app/tests/integration/product-rls.test.ts`

**Interfaces consumed:** existing `public.create_product`, `private.app_has_permission`, `products`, `inventory_balances`, `inventory_movements`.

**Interfaces produced:** nullable `selling_price_incl_gst`, nullable `weighted_average_cost`, nullable movement `cost_snapshot`, `public.set_product_selling_price(uuid,numeric)`.

- [ ] **Step 1: Change the unit test first so blank selling price must parse to `null`, not fail or become zero.**

Replace the existing blank-price rejection case in `tests/unit/product-validation.test.ts` with:

```ts
it('keeps a blank selling price genuinely unknown', () => {
  for (const sellingPriceInclGst of ['', null, undefined, '   ']) {
    const result = ProductInputSchema.safeParse({
      name: 'Price pending valve cap',
      category: 'valve',
      sellingPriceInclGst,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sellingPriceInclGst).toBeNull();
    }
  }
});

it('keeps an explicit zero selling price distinct from unknown', () => {
  const result = ProductInputSchema.safeParse({
    name: 'Explicit zero test',
    category: 'valve',
    sellingPriceInclGst: 0,
  });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.sellingPriceInclGst).toBe(0);
});
```

Run:

```powershell
Set-Location .\inventory-app
npm run test:unit -- product-validation.test.ts
```

Expected: the new blank-price test fails because the current schema rejects blank input.

- [ ] **Step 2: Implement nullable price validation.**

In `lib/products/validation.ts`, replace the required product-price schema with:

```ts
const nullableMoney = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    return value;
  },
  z.union([
    z.null(),
    z.coerce
      .number()
      .refine(Number.isFinite, 'Enter a valid price.')
      .refine((n) => n >= 0, 'Must be zero or more.')
      .refine((n) => n <= MAX_PRICE, 'That price looks too large.'),
  ]),
);
```

and set:

```ts
sellingPriceInclGst: nullableMoney,
```

Run the focused unit test again; expected: pass.

- [ ] **Step 3: Add the database migration and preserve zero-balance behavior.**

The migration must include these schema changes:

```sql
alter table public.products
  alter column selling_price_incl_gst drop not null;

alter table public.inventory_balances
  alter column weighted_average_cost drop not null;

alter table public.inventory_movements
  alter column cost_snapshot drop not null;

create or replace function private.normalize_empty_balance_wac()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.on_hand = 0 then
    new.weighted_average_cost := 0;
  end if;
  return new;
end;
$$;

revoke execute on function private.normalize_empty_balance_wac()
  from public, anon, authenticated, service_role;

create trigger inventory_balances_zero_wac
before insert or update on public.inventory_balances
for each row execute function private.normalize_empty_balance_wac();
```

Keep the existing `weighted_average_cost default 0` so new zero-quantity product balances start neutral. Positive opening stock with unknown cost will explicitly set WAC to `NULL` in Task 2.

- [ ] **Step 4: Replace `public.create_product` in the new migration with the existing signature and body, retaining all current Admin checks/upserts/audit, but permit `p_selling_price_incl_gst IS NULL`.**

Do not introduce a database check requiring a non-null price. Retain the existing non-negative check because PostgreSQL CHECK treats `NULL` as unknown/pass.

Add an audited setter:

```sql
create or replace function public.set_product_selling_price(
  p_product_id uuid,
  p_selling_price_incl_gst numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old_price numeric;
begin
  if not private.app_has_permission('inventory.edit_global_price') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;
  if p_selling_price_incl_gst is not null and p_selling_price_incl_gst < 0 then
    raise exception 'INVALID_PRICE' using errcode = '22023';
  end if;

  select selling_price_incl_gst into v_old_price
  from public.products
  where id = p_product_id
  for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.products
  set selling_price_incl_gst = p_selling_price_incl_gst
  where id = p_product_id;

  insert into public.audit_events (
    actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details
  )
  select
    v_actor,
    profile.role,
    profile.location_id,
    'PRODUCT_SELLING_PRICE_UPDATED',
    'product',
    p_product_id::text,
    jsonb_build_object('old_price', v_old_price, 'new_price', p_selling_price_incl_gst)
  from public.user_profiles as profile
  where profile.user_id = v_actor and profile.active;
end;
$$;

revoke execute on function public.set_product_selling_price(uuid, numeric)
  from public, anon, service_role;
grant execute on function public.set_product_selling_price(uuid, numeric)
  to authenticated;
```

- [ ] **Step 5: Make TypeScript contracts null-safe.**

In `lib/products/types.ts`:

```ts
sellingPriceInclGst: number | null;
```

In `lib/products/repository.ts`, change both row and mapper:

```ts
selling_price_incl_gst: number | null;
```

```ts
sellingPriceInclGst:
  row.selling_price_incl_gst == null
    ? null
    : Number(row.selling_price_incl_gst),
```

Keep `createProduct()` passing `input.sellingPriceInclGst` directly to `create_product`.

- [ ] **Step 6: Make the product form intentionally optional.**

Remove `required` from the selling-price input and add helper text directly below it:

```tsx
<p className="text-xs text-muted-foreground">
  Leave blank if the selling price has not been supplied yet.
</p>
```

Do not default the input to zero.

- [ ] **Step 7: Add integration coverage for NULL vs zero.**

In `product-rls.test.ts`, add Admin product creations with `p_selling_price_incl_gst: null` and `0`, query them back, and assert exact values `null` and `0`. Also assert a Manager still cannot create a product.

Run:

```powershell
npx supabase db reset
npm run test:unit -- product-validation.test.ts
npm run test:integration -- product-rls.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

- [ ] **Step 8: Commit Task 1.**

```powershell
git add inventory-app

git commit -m "feat(inventory): support pending product price and cost state"
```

---

## Task 2: Add the Dedicated Admin-Only Opening-Stock Ledger Path

**Files:**
- Create `inventory-app/supabase/migrations/20260904151000_opening_stock.sql`
- Modify `inventory-app/lib/inventory/types.ts`
- Modify `inventory-app/lib/inventory/repository.ts`
- Add/modify `inventory-app/tests/integration/opening-stock.test.ts`
- Extend `inventory-app/tests/integration/inventory-rpc.test.ts`
- Extend `inventory-app/tests/unit/stock-validation.test.ts`

**Interfaces consumed:** current append-only `inventory_movements`, current idempotency index, balance locking, public generic movement wrapper, Admin identity helper.

**Interfaces produced:** `opening_stock` movement type, `public.post_opening_stock(...)`, `postOpeningStock()` repository wrapper.

- [ ] **Step 1: Write failing integration cases.**

Create `tests/integration/opening-stock.test.ts` with cases that:

```ts
const result = await t.admin.rpc('post_opening_stock', {
  p_request_id: requestId,
  p_product_id: productId,
  p_location_id: t.regLocationId,
  p_quantity: 12,
  p_inbound_unit_cost: null,
  p_source_type: 'opening_stock_import',
  p_source_id: 'source-row-1',
});
expect(result.error).toBeNull();
```

Then assert Regency Park `on_hand = 12`, `weighted_average_cost = null`, Lonsdale remains `0`, the movement type is `opening_stock`, the movement cost snapshot is `null`, and an `OPENING_STOCK_POSTED` audit event exists.

Also assert:
- a Manager call is `ACCESS_DENIED`;
- zero/negative quantity is rejected;
- negative cost is rejected;
- replaying the same request ID does not double stock;
- public `post_inventory_movement(..., 'opening_stock', ...)` is rejected so callers cannot bypass the dedicated path.

Run before migration:

```powershell
npm run test:integration -- opening-stock.test.ts
```

Expected: fail because `post_opening_stock` does not exist.

- [ ] **Step 2: Extend ledger constraints without dropping `purchase_receipt`.**

In `20260904151000_opening_stock.sql`:

```sql
alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (
    movement_type in (
      'quick_stock_in', 'stock_out', 'adjustment', 'used_unit_in',
      'used_unit_out', 'purchase_receipt', 'opening_stock'
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_direction_check;

alter table public.inventory_movements
  add constraint inventory_movements_direction_check check (
    (movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt', 'opening_stock')
      and quantity_delta > 0)
    or (movement_type in ('stock_out', 'used_unit_out') and quantity_delta < 0)
    or movement_type = 'adjustment'
  );
```

- [ ] **Step 3: Add `public.post_opening_stock` as its own atomic transaction.**

The function must:
1. require `private.app_is_admin()`;
2. validate quantity and optional cost;
3. acquire an advisory transaction lock derived from actor/location/request ID before replay lookup;
4. lock the balance row `FOR UPDATE`;
5. return the existing movement on replay;
6. compute WAC with these exact rules:
   - cost `NULL` => resulting WAC `NULL`;
   - old on-hand `0` + known cost => WAC equals incoming cost;
   - old on-hand > `0` + old WAC `NULL` => WAC remains `NULL`;
   - otherwise use weighted average;
7. insert one immutable `opening_stock` movement;
8. update only the balance row;
9. write `OPENING_STOCK_POSTED` audit details.

Core WAC branch:

```sql
if p_inbound_unit_cost is null then
  v_new_wac := null;
elsif v_balance.on_hand = 0 then
  v_new_wac := p_inbound_unit_cost;
elsif v_balance.weighted_average_cost is null then
  v_new_wac := null;
else
  v_new_wac := (
    (v_balance.on_hand * v_balance.weighted_average_cost)
    + (p_quantity * p_inbound_unit_cost)
  ) / (v_balance.on_hand + p_quantity);
end if;
```

Return the same shape as current inventory mutation RPCs:

```sql
returns table (
  movement_id uuid,
  on_hand integer,
  reserved integer,
  available integer,
  weighted_average_cost numeric
)
```

Grant execute only to `authenticated`; the body itself remains Admin-gated.

- [ ] **Step 4: Harden the public generic wrapper.**

Replace the current `public.post_inventory_movement` wrapper from the latest purchase-receipt integrity migration with the same implementation except for this guard:

```sql
if p_movement_type = 'purchase_receipt' then
  raise exception 'PURCHASE_RECEIPT_REQUIRES_PURCHASE_ORDER' using errcode = '42501';
end if;
if p_movement_type = 'opening_stock' then
  raise exception 'OPENING_STOCK_REQUIRES_IMPORT_PATH' using errcode = '42501';
end if;
```

Do not expose `private.post_inventory_movement`.

- [ ] **Step 5: Add the TypeScript repository contract.**

In `lib/inventory/types.ts` add:

```ts
export type OpeningStockInput = {
  requestId: string;
  productId: string;
  locationId: string;
  quantity: number;
  inboundUnitCost: number | null;
  sourceType: string;
  sourceId: string;
};
```

Do not add `opening_stock` to the ordinary `MovementType` union used by Quick Stock-In; keep it reachable only through a dedicated repository method.

In `lib/inventory/repository.ts` add `postOpeningStock()` calling `post_opening_stock` and reuse `toResult()`.

- [ ] **Step 6: Preserve normal cost-required Stock In.**

Keep `StockInSchema.unitCost` unchanged. Add/retain the unit assertion:

```ts
expect(
  StockInSchema.safeParse({ productId, locationId, quantity: 5, unitCost: '' }).success,
).toBe(false);
```

Add an integration assertion that ordinary `quick_stock_in` with `p_inbound_unit_cost: null` still returns `INBOUND_COST_REQUIRED`.

- [ ] **Step 7: Verify Task 2.**

```powershell
npx supabase db reset
npm run test:unit -- stock-validation.test.ts
npm run test:integration -- opening-stock.test.ts inventory-rpc.test.ts inventory-security-hardening.test.ts goods-receiving.test.ts
npm run typecheck
npm run lint
```

Expected: all pass; purchase receipts remain functional.

- [ ] **Step 8: Commit Task 2.**

```powershell
git add inventory-app

git commit -m "feat(inventory): add audited opening stock ledger path"
```

---

## Task 3: Add Immutable Opening-Cost Assignment and WAC Reconstruction

**Files:**
- Create `inventory-app/supabase/migrations/20260904152000_opening_stock_costs.sql`
- Modify `inventory-app/lib/inventory/types.ts`
- Modify `inventory-app/lib/inventory/repository.ts`
- Extend `inventory-app/tests/integration/opening-stock.test.ts`

**Interfaces produced:** `opening_stock_cost_assignments`, `public.list_pending_opening_costs`, `public.assign_opening_stock_cost`, private WAC replay routine.

- [ ] **Step 1: Add failing tests for delayed cost assignment.**

Cover this exact timeline in `opening-stock.test.ts`:
1. opening stock `10 @ unknown` => WAC `NULL`;
2. normal Quick Stock-In `10 @ 500` => WAC stays `NULL` because unresolved opening stock remains;
3. stock out `2` => WAC stays `NULL`;
4. assign opening cost `400` => replayed current WAC becomes `450` for the remaining 18 units;
5. original opening movement remains unchanged with `inbound_unit_cost = NULL` and `cost_snapshot = NULL`;
6. a second assignment attempt fails;
7. Manager assignment fails.

Expected pre-migration result: RPCs/table are missing.

- [ ] **Step 2: Create the immutable assignment table.**

```sql
create table public.opening_stock_cost_assignments (
  opening_movement_id uuid primary key references public.inventory_movements(id),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now()
);

alter table public.opening_stock_cost_assignments enable row level security;
revoke all on public.opening_stock_cost_assignments
  from public, anon, authenticated, service_role;
grant select on public.opening_stock_cost_assignments to service_role;
```

No authenticated direct write path is allowed.

- [ ] **Step 3: Implement chronological WAC reconstruction.**

Create `private.rebuild_current_wac(p_product_id uuid, p_location_id uuid)` that locks the balance and replays `inventory_movements` ordered by `created_at, id`. For each movement maintain `v_quantity` and `v_wac`.

Use these inbound cost sources:

```sql
case
  when movement.movement_type = 'opening_stock'
    then coalesce(movement.inbound_unit_cost, assignment.unit_cost)
  when movement.movement_type in ('quick_stock_in', 'used_unit_in', 'purchase_receipt')
    then movement.inbound_unit_cost
  else null
end
```

For inbound movement types:

```sql
v_before_quantity := v_quantity;
v_quantity := v_quantity + movement.quantity_delta;

if v_unit_cost is null then
  v_wac := null;
elsif v_before_quantity = 0 then
  v_wac := v_unit_cost;
elsif v_wac is null then
  v_wac := null;
else
  v_wac := (
    (v_before_quantity * v_wac)
    + (movement.quantity_delta * v_unit_cost)
  ) / v_quantity;
end if;
```

For outbound/adjustment, apply the quantity delta and preserve WAC. Whenever replay reaches quantity `0`, set WAC to `0`. Reject negative replay quantity. At the end, assert replay quantity equals the locked `inventory_balances.on_hand` before updating only `weighted_average_cost`.

- [ ] **Step 4: Add Admin-only pending-cost and assignment RPCs.**

`public.list_pending_opening_costs(p_product_id uuid, p_location_id uuid)` returns opening movement ID, quantity, and created time only when the opening movement has no embedded cost and no assignment.

`public.assign_opening_stock_cost(p_opening_movement_id uuid, p_unit_cost numeric)` must:
- require Admin;
- reject negative/null cost;
- lock/read the opening movement;
- require `movement_type = 'opening_stock'`;
- reject if `inbound_unit_cost` is already known;
- insert one assignment row, letting PK uniqueness block reassignment;
- call `private.rebuild_current_wac`;
- write `OPENING_STOCK_COST_ASSIGNED` audit with product/location/movement/unit cost.

- [ ] **Step 5: Add repository wrappers.**

Types:

```ts
export type PendingOpeningCost = {
  movementId: string;
  quantity: number;
  createdAt: string;
};
```

Repository functions:

```ts
export async function listPendingOpeningCosts(
  client: SupabaseClient,
  productId: string,
  locationId: string,
): Promise<PendingOpeningCost[]>;

export async function assignOpeningStockCost(
  client: SupabaseClient,
  movementId: string,
  unitCost: number,
): Promise<void>;
```

Map DB sentinels to explicit user-facing messages in `lib/inventory/errors.ts`:

```ts
OPENING_COST_ALREADY_ASSIGNED: 'An opening cost has already been assigned to this stock movement.',
NOT_OPENING_STOCK: 'That movement is not opening stock.',
```

- [ ] **Step 6: Verify Task 3.**

```powershell
npx supabase db reset
npm run test:integration -- opening-stock.test.ts inventory-rpc.test.ts inventory-concurrency.test.ts goods-receiving.test.ts
npm run typecheck
npm run lint
```

Expected: delayed cost reconstruction passes and normal concurrency/receiving stays green.

- [ ] **Step 7: Commit Task 3.**

```powershell
git add inventory-app

git commit -m "feat(inventory): add immutable opening cost assignment"
```

---

## Task 4: Report Known Inventory Value Separately From Unvalued Stock

**Files:**
- Create `inventory-app/supabase/migrations/20260904153000_pending_valuation.sql`
- Modify `inventory-app/lib/inventory/queries.ts`
- Modify `inventory-app/app/(protected)/dashboard/page.tsx`
- Extend `inventory-app/tests/integration/inventory-summary.test.ts`

**Interfaces produced:** `public.inventory_valuation_for_scope(text)` returning `known_value` and `unvalued_units`.

- [ ] **Step 1: Add failing valuation integration cases.**

Seed one known-cost item and one positive-on-hand opening-stock item with NULL WAC. Assert the valuation RPC reports the known item value only and reports unresolved quantity separately.

Example expectation:

```ts
expect(Number(data?.[0]?.known_value)).toBe(1000);
expect(Number(data?.[0]?.unvalued_units)).toBe(12);
```

Also assert Manager permission denial remains unchanged.

- [ ] **Step 2: Create the permission-gated valuation RPC.**

```sql
create or replace function public.inventory_valuation_for_scope(
  p_location_code text default null
)
returns table (known_value numeric, unvalued_units bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_has_permission('reports.view_inventory_value')
    or not private.app_has_permission('inventory.view_cost') then
    raise exception 'ACCESS_DENIED' using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(
      case when b.weighted_average_cost is not null
        then b.on_hand * b.weighted_average_cost
        else 0 end
    ), 0)::numeric as known_value,
    coalesce(sum(
      case when b.on_hand > 0 and b.weighted_average_cost is null
        then b.on_hand else 0 end
    ), 0)::bigint as unvalued_units
  from public.inventory_balances as b
  join public.products as p on p.id = b.product_id and p.active
  join public.locations as l on l.id = b.location_id
  where (p_location_code is null or l.code = p_location_code)
    and (
      (select private.app_is_admin())
      or b.location_id = (select private.app_user_location_id())
    );
end;
$$;

revoke execute on function public.inventory_valuation_for_scope(text)
  from public, anon, service_role;
grant execute on function public.inventory_valuation_for_scope(text)
  to authenticated;
```

Retain the old `inventory_value_for_scope` RPC for compatibility until all callers are migrated; do not use it for the dashboard after this task.

- [ ] **Step 3: Update dashboard query contracts.**

In `DashboardInventoryMetrics` add:

```ts
unvaluedUnits: number | null;
```

Call `inventory_valuation_for_scope` and map both fields. If permission is missing, keep both `inventoryValue` and `unvaluedUnits` as `null`.

- [ ] **Step 4: Update the dashboard UI.**

Add a visible tile:

```tsx
<Metric
  label="Unvalued stock"
  value={
    metrics.unvaluedUnits === null
      ? '—'
      : `${metrics.unvaluedUnits} units`
  }
  tone={metrics.unvaluedUnits && metrics.unvaluedUnits > 0 ? 'warning' : 'neutral'}
/>
```

Rename the value label to `Known inventory value` so the dashboard cannot imply unresolved stock is free.

- [ ] **Step 5: Verify and commit.**

```powershell
npx supabase db reset
npm run test:integration -- inventory-summary.test.ts inventory-security-hardening.test.ts
npm run typecheck
npm run lint
npm run build

git add inventory-app

git commit -m "feat(inventory): separate known value from unvalued stock"
```

---

## Task 5: Build a Strict Parser and Deterministic Identity for the 53-Row Source File

**Files:**
- Create `inventory-app/lib/opening-stock/types.ts`
- Create `inventory-app/lib/opening-stock/parse.ts`
- Create `inventory-app/lib/opening-stock/source.ts`
- Add `inventory-app/tests/unit/opening-stock-parse.test.ts`

**Interfaces consumed:** `inventory-app/data/opening-stock-2026-09-04.csv`, existing `normalizeLookup()`.

**Interfaces produced:** parsed immutable source rows, dataset SHA, normalized row keys, deterministic movement request IDs.

- [ ] **Step 1: Write source contract tests before parser code.**

The unit test must load the real repository CSV and assert:

```ts
expect(source.rows).toHaveLength(53);
expect(source.rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(725);
expect(new Set(source.rows.map((row) => row.location))).toEqual(new Set(['REG']));
expect(new Set(source.rows.map((row) => row.condition))).toEqual(new Set(['new']));
expect(source.rows.every((row) => row.costPrice === null)).toBe(true);
expect(source.rows.every((row) => row.sellingPrice === null)).toBe(true);
```

Also test duplicate normalized row keys, wrong header, malformed quantity, wrong location, wrong condition, and nonblank unexpected price.

Run:

```powershell
npm run test:unit -- opening-stock-parse.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 2: Define the exact row/source types.**

```ts
export type OpeningStockRow = {
  rowNumber: number;
  brand: string;
  pattern: string;
  size: string;
  quantity: number;
  condition: 'new';
  category: 'truck_tyre';
  location: 'REG';
  costPrice: null;
  sellingPrice: null;
  rowKey: string;
  requestId: string;
};

export type OpeningStockSource = {
  datasetKey: string;
  sha256: string;
  rows: OpeningStockRow[];
  totalQuantity: number;
};
```

- [ ] **Step 3: Implement a strict quoted-field CSV parser, not `line.split(',')`.**

The parser state machine must toggle quote mode on `"`, treat doubled `""` as a literal quote, split on commas only outside quotes, and reject an unterminated quote. Validate the exact 14-column header from the committed CSV.

Map source strings with these fixed rules:
- `Condition` must case-insensitively equal `New`;
- `Category` must equal `Truck Tyre`;
- `Location` must equal `Regency Park` and map to `REG`;
- Quantity must be a positive integer;
- Cost Price and Selling Price must be blank;
- Brand, Pattern, Size must be nonblank;
- normalized key is `BRAND|PATTERN|SIZE|NEW` using `normalizeLookup`.

- [ ] **Step 4: Generate stable UUID-shaped request IDs from SHA-256.**

In `source.ts` use Node `createHash`:

```ts
function deterministicUuid(input: string): string {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
  const chars = hex.split('');
  chars[12] = '5';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16]!, 16) & 3]!;
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}
```

Use `datasetKey = opening-stock-2026-09-04:<sha256>` and `requestId = deterministicUuid(`${datasetKey}:${rowKey}`)`.

Reject duplicate `rowKey` values before returning the source.

- [ ] **Step 5: Load the committed source from one fixed server-side path.**

Use:

```ts
const SOURCE_PATH = resolve(
  process.cwd(),
  'data',
  'opening-stock-2026-09-04.csv',
);
```

`loadOpeningStockSource()` reads UTF-8, hashes the exact bytes, parses the file, and asserts exactly 53 rows / 725 quantity. The app must not accept browser-supplied row data as the authoritative import source.

- [ ] **Step 6: Verify and commit.**

```powershell
npm run test:unit -- opening-stock-parse.test.ts
npm run typecheck
npm run lint

git add inventory-app/lib/opening-stock inventory-app/tests/unit/opening-stock-parse.test.ts

git commit -m "feat(inventory): validate fixed opening stock source"
```

---

## Task 6: Make Each Source Row Atomic and Idempotent at the Database Boundary

**Files:**
- Create `inventory-app/supabase/migrations/20260904154000_opening_stock_import.sql`
- Create `inventory-app/lib/opening-stock/repository.ts`
- Extend `inventory-app/tests/integration/opening-stock.test.ts`

**Interfaces consumed:** `public.create_product`, `public.post_opening_stock`, normalized tyre lookup tables.

**Interfaces produced:** `opening_stock_import_rows`, `public.import_opening_stock_row`, preview/import repository helpers, import report.

- [ ] **Step 1: Add failing integration coverage for an imported row and replay.**

Call the new RPC with a known Ralson-style row and assert:
- first call creates or matches exactly one product and posts quantity;
- second identical call returns replayed status and adds zero extra quantity;
- mismatched condition/location is not accepted because the RPC itself fixes condition to New and requires `REG`;
- a Manager is denied;
- an ambiguous product master match returns `AMBIGUOUS_PRODUCT_MATCH` rather than silently picking one.

- [ ] **Step 2: Create immutable import evidence.**

```sql
create table public.opening_stock_import_rows (
  dataset_key text not null,
  row_key text not null,
  row_number integer not null check (row_number > 0),
  product_id uuid not null references public.products(id),
  inventory_movement_id uuid not null unique references public.inventory_movements(id),
  created_product boolean not null,
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  primary key (dataset_key, row_key)
);

alter table public.opening_stock_import_rows enable row level security;
revoke all on public.opening_stock_import_rows
  from public, anon, authenticated, service_role;
grant select on public.opening_stock_import_rows to service_role;
```

- [ ] **Step 3: Add one private normalization helper used by the import RPC.**

```sql
create or replace function private.normalize_opening_lookup(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select upper(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')))
$$;
```

Revoke public execution.

- [ ] **Step 4: Implement `public.import_opening_stock_row`.**

Signature:

```sql
public.import_opening_stock_row(
  p_dataset_key text,
  p_row_key text,
  p_row_number integer,
  p_request_id uuid,
  p_brand text,
  p_pattern text,
  p_size text,
  p_quantity integer,
  p_location_code text
)
returns table (
  product_id uuid,
  movement_id uuid,
  created_product boolean,
  replayed boolean
)
```

Rules:
- Admin-only;
- `p_location_code` must equal `REG`;
- quantity > 0;
- dataset/row key/brand/size nonblank;
- acquire `pg_advisory_xact_lock(hashtextextended(dataset_key || ':' || row_key, 0))`;
- return the existing evidence row with `replayed = true` if present;
- query candidate products by `truck_tyre`, condition `new`, normalized brand, normalized pattern including blank, and normalized size;
- `0` candidates => call `public.create_product` with name `concat_ws(' ', brand, pattern, size)`, price `NULL`, category `truck_tyre`, condition `new`;
- `1` candidate => reuse it;
- `>1` => raise `AMBIGUOUS_PRODUCT_MATCH`;
- call `public.post_opening_stock` with the supplied deterministic request ID and `NULL` inbound cost;
- insert the evidence row;
- return created/replayed state.

Because one RPC call is one PostgreSQL transaction, product creation + movement + evidence is atomic per source row.

- [ ] **Step 5: Build server repository orchestration.**

Define:

```ts
export type OpeningStockImportReport = {
  sourceRows: number;
  sourceQuantity: number;
  createdProducts: number;
  matchedProducts: number;
  postedRows: number;
  postedQuantity: number;
  replayedRows: number;
  errors: Array<{ rowNumber: number; rowKey: string; message: string }>;
};
```

`importOpeningStockDataset(client, source)` loops sequentially through the already-validated rows and calls `import_opening_stock_row`. It continues after a per-row error so the final report is useful; safe retry is guaranteed by the evidence key and request ID.

For a successful first run, enforce at application level:

```ts
if (report.errors.length === 0 && report.postedQuantity !== 725) {
  throw new Error('Opening stock import quantity did not reconcile to 725.');
}
```

- [ ] **Step 6: Add preview matching.**

`previewOpeningStockDataset()` reads the product master with brand/pattern/size joins, builds the same normalized identity map in TypeScript, and marks each source row as `create`, `match`, or `ambiguous`. Preview is informational; the DB RPC rechecks identity during import.

- [ ] **Step 7: Verify and commit.**

```powershell
npx supabase db reset
npm run test:unit -- opening-stock-parse.test.ts
npm run test:integration -- opening-stock.test.ts product-rls.test.ts inventory-security-hardening.test.ts
npm run typecheck
npm run lint

git add inventory-app

git commit -m "feat(inventory): add idempotent opening stock import service"
```

---

## Task 7: Add the Admin Preview and “Make Live” Workflow

**Files:**
- Create `inventory-app/app/(protected)/inventory/import/page.tsx`
- Create `inventory-app/app/(protected)/inventory/import/actions.ts`
- Create `inventory-app/components/inventory/opening-stock-import-panel.tsx`
- Modify `inventory-app/app/(protected)/inventory/page.tsx`
- Add `inventory-app/tests/unit/opening-stock-import-panel.test.tsx`

**Interfaces consumed:** fixed source loader, preview repository, import repository, server access context.

- [ ] **Step 1: Write the component test first.**

Render the panel with `53` rows / `725` quantity and assert it visibly states:
- `53 product lines`;
- `725 tyres`;
- `Regency Park`;
- `New`;
- `Cost pending`;
- `Selling price pending`;
- action label `Make 725 tyres live`.

Also test the completion report surface for created/matched/posted/replayed/errors.

Expected before component creation: module resolution failure.

- [ ] **Step 2: Create the Admin-only page.**

Server page behavior:

```ts
const access = await getCurrentAccess();
if (access.role !== 'admin') redirect('/inventory');
const source = await loadOpeningStockSource();
const supabase = await createServerSupabaseClient();
const preview = await previewOpeningStockDataset(supabase, source);
```

Render a `PageHeader` and the import panel. No upload control is needed for this fixed source.

- [ ] **Step 3: Create the server action and never trust client rows.**

`runOpeningStockImportAction` must:
1. re-check current user is Admin;
2. re-load the CSV from disk;
3. re-validate SHA, 53 rows and 725 total via `loadOpeningStockSource()`;
4. run `importOpeningStockDataset`;
5. if there are zero errors, write `OPENING_STOCK_IMPORT_COMPLETED` with dataset SHA and counts using `recordAuditEvent`;
6. revalidate `/dashboard`, `/inventory`, and `/inventory/import`;
7. return the report.

The form posts no product/quantity arrays.

- [ ] **Step 4: Build the operational UI.**

Use the existing industrial design system and warning tone. The confirmation area must state:

```tsx
<p className="text-sm text-muted-foreground">
  This posts the confirmed quantities to live Regency Park inventory. Cost and
  selling price stay pending and are not treated as $0.
</p>
```

The button is disabled while pending and reads `Making stock live…` during submission.

The preview table includes Row, Brand, Pattern, Size, Qty, and Match status. On mobile render compact cards rather than a forced wide table.

- [ ] **Step 5: Add the Inventory entry point.**

For Admin only, add a second PageHeader action link next to `New Product`:

```tsx
<Link href="/inventory/import" className="h-10 rounded-md border border-input px-4 text-sm font-medium leading-10">
  Opening Stock Import
</Link>
```

Managers must not see the link.

- [ ] **Step 6: Verify and commit.**

```powershell
npm run test:unit -- opening-stock-import-panel.test.tsx
npm run typecheck
npm run lint
npm run build

git add inventory-app

git commit -m "feat(inventory): add opening stock preview and live import UI"
```

---

## Task 8: Show Pending Financial States and Let the Client Fill Them Later

**Files:**
- Modify `inventory-app/lib/format.ts`
- Modify `inventory-app/lib/inventory/queries.ts`
- Modify `inventory-app/components/inventory/inventory-view.tsx`
- Modify `inventory-app/app/(protected)/inventory/[productId]/page.tsx`
- Modify `inventory-app/app/(protected)/inventory/actions.ts`
- Modify `inventory-app/lib/products/repository.ts`
- Create `inventory-app/components/inventory/set-selling-price-form.tsx`
- Create `inventory-app/components/inventory/assign-opening-cost-form.tsx`
- Add `inventory-app/tests/unit/pending-financial-display.test.tsx`

- [ ] **Step 1: Make inventory query types nullable before rendering.**

Change both summary row types:

```ts
sellingPriceInclGst: number | null;
```

and map:

```ts
sellingPriceInclGst:
  row.selling_price_incl_gst == null
    ? null
    : Number(row.selling_price_incl_gst),
```

- [ ] **Step 2: Add one explicit nullable currency formatter.**

In `lib/format.ts`:

```ts
export function formatAudOrPending(amount: number | null): string {
  return amount == null ? '—' : formatAud(amount);
}
```

Do not change `formatAud(number)` itself.

- [ ] **Step 3: Write UI tests before changing the list.**

Use an inventory row with `sellingPriceInclGst: null`, positive quantity and `weightedAverageCost: null`. Assert desktop/mobile output includes `Price Pending`, displays `—`, and for a cost-authorized single-branch view includes `Cost Pending`. Assert numeric `0` renders as `$0.00`, not pending.

- [ ] **Step 4: Update the inventory list.**

Change `ProductGroup.sellingPriceInclGst` to `number | null`. Render:

```tsx
{g.sellingPriceInclGst == null ? (
  <div className="flex justify-end gap-2">
    <span>—</span>
    <StatusBadge tone="warning">Price Pending</StatusBadge>
  </div>
) : (
  formatAud(g.sellingPriceInclGst)
)}
```

For single-branch authorized WAC:

```tsx
{only?.onHand && only.onHand > 0 && only.weightedAverageCost == null ? (
  <StatusBadge tone="warning">Cost Pending</StatusBadge>
) : only?.weightedAverageCost != null ? (
  formatAud(only.weightedAverageCost)
) : (
  '—'
)}
```

Keep cost information hidden entirely from users without `inventory.view_cost`.

- [ ] **Step 5: Add the selling-price repository method and action.**

Repository:

```ts
export async function setProductSellingPrice(
  client: SupabaseClient,
  productId: string,
  price: number | null,
): Promise<void> {
  const { error } = await client.rpc('set_product_selling_price', {
    p_product_id: productId,
    p_selling_price_incl_gst: price,
  });
  if (error) throw new Error('Could not update the selling price.');
}
```

Server action checks:

```ts
if (!hasPermission(access, 'inventory.edit_global_price')) {
  return actionError('You do not have permission to edit the selling price.');
}
```

Use the same nullable-money parsing rules as product creation.

- [ ] **Step 6: Add the selling-price form.**

Render it only for Admin or Manager with `inventory.edit_global_price`. The input may be blank to preserve/restore Pending; numeric `0` remains valid. Successful save revalidates inventory and product detail.

- [ ] **Step 7: Add the opening-cost assignment form.**

On product detail, Admin only:
- find the Regency Park summary row;
- resolve Regency Park location ID;
- call `listPendingOpeningCosts`;
- for each pending opening movement show quantity/date and a non-negative Unit Cost input;
- submit `movementId` + `unitCost` to an Admin-only action calling `assignOpeningStockCost`.

Managers never receive the pending movement list.

- [ ] **Step 8: Add clear product-detail warning cards.**

When price is null:

```tsx
<StatusBadge tone="warning">Selling price pending</StatusBadge>
```

When an authorized user sees positive stock with null WAC:

```tsx
<StatusBadge tone="warning">Opening cost pending</StatusBadge>
```

The displayed selling price remains `—` until assigned.

- [ ] **Step 9: Verify and commit.**

```powershell
npm run test:unit -- pending-financial-display.test.tsx product-validation.test.ts stock-form.test.tsx
npx supabase db reset
npm run test:integration -- opening-stock.test.ts product-rls.test.ts inventory-summary.test.ts
npm run typecheck
npm run lint
npm run build

git add inventory-app

git commit -m "feat(inventory): show and resolve pending opening financials"
```

---

## Task 9: Prove 53 Lines / 725 Tyres Live at Regency Park, Then Update Documentation and Rollout Evidence

**Files:**
- Extend `inventory-app/tests/integration/opening-stock.test.ts`
- Create `inventory-app/tests/e2e/opening-stock.spec.ts`
- Modify `inventory-app/README.md`
- Modify `inventory-app/data/README.md`
- Modify `docs/superpowers/specs/2026-09-04-live-opening-stock-pending-prices-design.md`
- Update GitHub Issue #11 after implementation verification.

- [ ] **Step 1: Add exact-source integration acceptance.**

The test loads `opening-stock-2026-09-04.csv`, imports the entire source into a disposable DB, then asserts:

```ts
expect(source.rows).toHaveLength(53);
expect(source.totalQuantity).toBe(725);
expect(report.errors).toEqual([]);
expect(report.postedQuantity).toBe(725);
```

Query Regency Park balances for the imported product IDs and assert total on-hand `725`. Query Lonsdale for those IDs and assert total on-hand `0`. Assert all matched/created products are `truck_tyre` + `new` with `selling_price_incl_gst IS NULL`. Assert every positive REG imported balance has WAC `NULL` immediately after import.

Run the import a second time and assert total REG on-hand is still `725`, with all rows reported as replayed/already imported rather than duplicated.

- [ ] **Step 2: Add the browser acceptance flow.**

`tests/e2e/opening-stock.spec.ts`:
1. login as Admin;
2. open `/inventory/import`;
3. assert 53 / 725 / New / Regency Park / pending warnings;
4. click `Make 725 tyres live`;
5. assert success report;
6. navigate to `/inventory`, select Regency Park scope, search one known source product such as `Ralson RMR61 295/80r22.5`;
7. assert quantity is visible and Price Pending/Cost Pending presentation is correct;
8. login as REG Manager and assert stock is visible but cost data is not;
9. login as LON Manager and assert the imported Regency Park quantity is not visible in Lonsdale scope.

- [ ] **Step 3: Run the full disposable-database gate.**

```powershell
Set-Location .\inventory-app
npx supabase db reset
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Expected: all suites green. Existing purchasing, receiving, reorder, branch-RLS, no-negative-stock, concurrency, mobile stock, and auth tests must pass unchanged.

- [ ] **Step 4: Self-review the migration/security boundary before rollout.**

Verify with repository search that:
- no production code writes directly to `inventory_balances`;
- `opening_stock` is rejected by generic `post_inventory_movement`;
- only `post_opening_stock` / `import_opening_stock_row` can create opening movements;
- `opening_stock_cost_assignments` has no authenticated direct write grant;
- all new SECURITY DEFINER functions use `set search_path = ''`;
- no nullable value is mapped through `Number(null)`;
- no UI substitutes `$0` for `NULL`.

- [ ] **Step 5: Update documentation to match the now-approved design.**

In the spec change:

```md
**Status:** Approved
```

Update `inventory-app/data/README.md` so it no longer says cost is required before stock can go live. State instead that the confirmed 725 units may be posted through the dedicated opening-stock path with `Cost Pending` / `Price Pending` and later audited assignment.

Update `inventory-app/README.md` with the Admin workflow:

```md
Inventory → Opening Stock Import → Preview → Make 725 tyres live
```

and document that normal Quick Stock-In/PO receipt still requires cost.

- [ ] **Step 6: Commit the acceptance/docs task.**

```powershell
git add inventory-app docs/superpowers/specs/2026-09-04-live-opening-stock-pending-prices-design.md

git commit -m "test(inventory): verify 725 tyre opening stock rollout"
```

- [ ] **Step 7: Production preflight before any live database action.**

Confirm the target Supabase project belongs to the standalone inventory application, not the public website. Confirm a backup/snapshot is available. Confirm the currently deployed application version can accept nullable product price/WAC before applying the migrations.

Do not use `supabase db reset` against production.

- [ ] **Step 8: Apply production changes in safe order.**

1. push the verified code branch/commit;
2. apply the five new inventory migrations to the inventory Supabase project;
3. deploy the compatible Next.js app;
4. sign in as Admin and open `/inventory/import`;
5. verify preview says exactly 53 rows / 725 tyres / New / Regency Park;
6. run the import once;
7. confirm report has zero errors and exactly 725 posted units;
8. verify Lonsdale is unchanged;
9. verify inventory list shows pending financial states rather than `$0`;
10. save the import report as rollout evidence.

If any preview total differs from 53 / 725, stop without posting stock.

- [ ] **Step 9: Update GitHub Issue #11 only after verified rollout.**

Record the implementation commit, migration names, test-gate result, and production import result. Close Issue #11 as completed only when the live system shows exactly 725 Regency Park opening tyres with pending financial fields and Lonsdale unchanged.

---

## Final Acceptance Gate

This feature is complete only when all of the following are true:

- [ ] The exact committed source parses to 53 lines / 725 tyres.
- [ ] Every source row is New and Regency Park.
- [ ] All 725 quantities are visible as live Regency Park stock.
- [ ] Lonsdale receives zero units from this source.
- [ ] Selling price remains `NULL` until a user explicitly assigns it.
- [ ] Opening cost remains `NULL` until Admin explicitly assigns it.
- [ ] `NULL` never renders or calculates as `$0`.
- [ ] Price Pending and Cost Pending are visible states.
- [ ] Normal Quick Stock-In and PO receiving still require known cost.
- [ ] Opening-stock posting is Admin-only and idempotent.
- [ ] Original opening movements remain immutable after cost assignment.
- [ ] Delayed cost assignment reconstructs current WAC correctly.
- [ ] Known inventory value and unvalued units are reported separately.
- [ ] Branch/RLS/cost-permission/concurrency/no-negative-stock tests remain green.
- [ ] Unit, integration, typecheck, lint, build, and E2E gates all pass.
- [ ] Production import is not run unless preview reconciles exactly to 53 / 725.