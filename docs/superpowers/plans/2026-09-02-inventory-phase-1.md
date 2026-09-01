# 24/7 Inventory Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-capable slice of the standalone 24/7 Truck Tyre Services inventory application: authentication, Admin/Manager branch isolation, responsive PC/mobile shell, product and new/used tyre catalogue, append-only stock ledger, Stock In/Out, adjustments, location-specific WAC, and low-stock management.

**Architecture:** Leave the public website at repository root unchanged. Create an independent Next.js application under `inventory-app/`, deployed as a separate Vercel project with its own Supabase project. Normal operations use authenticated user-scoped Supabase clients plus RLS/security-definer RPCs; only Admin user provisioning uses a server-only service-role client. PostgreSQL owns authoritative stock writes so authorization, no-negative-stock checks, WAC, balance changes, used-unit state, movement history, and audit writes commit atomically.

**Tech Stack:** Node.js 22.x, Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Supabase PostgreSQL/Auth/Storage, Vitest, Testing Library, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-02-inventory-software-design.md`

## Global Constraints

- Inventory is a separate authenticated application/deployment; do not add internal routes to the public marketing app.
- Node.js `22.x`; Next.js major `16`; React major `19`; TypeScript major `5`; Tailwind major `4`.
- Locations are exactly Lonsdale (`LON`) and Regency Park (`REG`) in Phase 1.
- Admin can access both locations and `All Locations`; each Manager is assigned to one location and cannot switch.
- Manager operational permissions are configurable; branch isolation remains non-grantable.
- No QR or barcode feature.
- New tyres are quantity-tracked; used tyres support grouped quantity plus individually tracked units.
- Selling price is one global GST-inclusive product price; WAC is location-specific.
- Every non-zero posted stock change creates an immutable movement and audit event.
- Negative stock is blocked in the database even under concurrent requests.
- Phase 1 is online-only.
- Purchasing, transfers, stocktake, customers, jobs, POS, invoices, Stripe, Resend reminders, and full accounting reports are deferred to later plans.

## File Map

```text
inventory-app/
├── .env.example
├── package.json
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── proxy.ts
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── manifest.ts
│   ├── (auth)/login/{page.tsx,actions.ts}
│   └── (protected)/
│       ├── layout.tsx
│       ├── actions.ts
│       ├── dashboard/page.tsx
│       ├── inventory/{page.tsx,actions.ts}
│       ├── inventory/[productId]/page.tsx
│       ├── stock/{actions.ts,in/page.tsx,out/page.tsx,adjust/page.tsx}
│       └── settings/users/{page.tsx,actions.ts}
├── components/
│   ├── shell/
│   ├── location/
│   ├── inventory/
│   ├── stock/
│   └── ui/
├── lib/
│   ├── app-config.ts
│   ├── auth/
│   ├── location/
│   ├── products/
│   ├── inventory/
│   └── supabase/
├── public/brand/
├── scripts/bootstrap-admin.ts
├── supabase/{config.toml,seed.sql,migrations/}
└── tests/{unit,integration,e2e}/

.github/workflows/inventory.yml
docs/inventory-phase-1-deployment.md
```

Boundary rules:

- `lib/auth`: role/permission/access context only.
- `lib/location`: Admin scope and Manager fixed-scope resolution.
- `lib/products`: catalogue validation/read/write adapters.
- `lib/inventory`: stock query/mutation adapters and friendly errors.
- React components never create service-role clients.
- TypeScript never performs authoritative WAC arithmetic for writes.

---

### Task 1: Scaffold the Separate Inventory App

**Files:**
- Create: `inventory-app/package.json`
- Create: `inventory-app/{tsconfig.json,next.config.ts,postcss.config.mjs,vitest.config.ts,playwright.config.ts,.env.example}`
- Create: `inventory-app/app/{layout.tsx,globals.css,manifest.ts}`
- Create: `inventory-app/lib/app-config.ts`
- Create: `inventory-app/tests/unit/app-config.test.ts`
- Copy: `public/brand/logo-real-horizontal.png` → `inventory-app/public/brand/logo-real-horizontal.png`
- Copy: `public/brand/logo-real-mark.png` → `inventory-app/public/brand/logo-real-mark.png`

**Interfaces:**
- Produces `APP_NAME`, `LOCATION_CODES`, `LocationCode`.
- Produces dev server `http://localhost:3100`.
- Produces test/lint/typecheck/build scripts used by all later tasks.

- [ ] **Step 1: Create package manifest and install dependencies**

Use root-compatible versions for Next/React/TypeScript/Tailwind:

```json
{
  "name": "247-truck-tyre-inventory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": "22.x" },
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build",
    "start": "next start -p 3100",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@supabase/ssr": "latest",
    "@supabase/supabase-js": "latest",
    "class-variance-authority": "latest",
    "clsx": "latest",
    "lucide-react": "latest",
    "next": "16.3.3",
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "tailwind-merge": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "@tailwindcss/postcss": "4.2.1",
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/node": "22.19.19",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "latest",
    "eslint": "9.39.4",
    "eslint-config-next": "16.3.3",
    "jsdom": "latest",
    "tailwindcss": "4.2.1",
    "typescript": "5.9.3",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

Run:

```powershell
Set-Location -LiteralPath .\inventory-app
npm install
npx shadcn@latest init -d
npx shadcn@latest add button input card table badge sheet select dropdown-menu dialog form label textarea separator skeleton
```

- [ ] **Step 2: Write the first failing unit test**

```ts
import { describe, expect, it } from "vitest";
import { APP_NAME, LOCATION_CODES } from "../../lib/app-config";

describe("inventory configuration", () => {
  it("uses the approved app name and branches", () => {
    expect(APP_NAME).toBe("24/7 Inventory");
    expect(LOCATION_CODES).toEqual(["LON", "REG"]);
  });
});
```

- [ ] **Step 3: Run it and verify failure**

```powershell
npm run test:unit -- app-config.test.ts
```

Expected: FAIL because `lib/app-config.ts` is missing.

- [ ] **Step 4: Implement config and base shell**

```ts
export const APP_NAME = "24/7 Inventory" as const;
export const LOCATION_CODES = ["LON", "REG"] as const;
export type LocationCode = (typeof LOCATION_CODES)[number];
```

`app/layout.tsx` uses title `24/7 Inventory`; `manifest.ts` uses `display: "standalone"` and `start_url: "/dashboard"`. `globals.css` contains Tailwind imports and compact internal-app tokens only; do not copy the public marketing stylesheet.

`.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_INVENTORY_APP_URL=http://localhost:3100
SUPABASE_TEST_URL=
SUPABASE_TEST_ANON_KEY=
SUPABASE_TEST_SERVICE_ROLE_KEY=
```

- [ ] **Step 5: Verify foundation**

```powershell
npm run test:unit
npm run typecheck
npm run lint
npm run build
```

Expected: all exit `0`.

- [ ] **Step 6: Commit**

```bash
git add inventory-app
git commit -m "feat(inventory): scaffold standalone app"
```

---

### Task 2: Add Locations, Roles, Permissions, Audit, and RLS

**Files:**
- Create: `inventory-app/supabase/config.toml`
- Create: `inventory-app/supabase/migrations/20260902090000_identity_access.sql`
- Create: `inventory-app/supabase/seed.sql`
- Create: `inventory-app/lib/auth/{types.ts,permissions.ts}`
- Create: `inventory-app/tests/unit/permissions.test.ts`
- Create: `inventory-app/tests/integration/access-rls.test.ts`

**Interfaces:**
- DB tables: `locations`, `user_profiles`, `manager_permissions`, `audit_events`.
- DB helpers: `app_is_admin()`, `app_user_location_id()`, `app_has_permission(text)`, `app_audit_event(...)`.
- TS types: `UserRole`, `PermissionKey`, `UserAccessContext`.
- TS helper: `hasPermission(access,key)`.

- [ ] **Step 1: Write failing permission tests**

```ts
import { expect, it } from "vitest";
import { hasPermission } from "../../lib/auth/permissions";
import type { UserAccessContext } from "../../lib/auth/types";

const manager: UserAccessContext = {
  userId: "u1",
  role: "manager",
  locationId: "l1",
  locationCode: "LON",
  permissions: new Set(["inventory.view", "inventory.stock_out"]),
};

it("admin passes operational permission checks", () => {
  expect(hasPermission({ ...manager, role: "admin", locationId: null, locationCode: null, permissions: new Set() }, "inventory.adjust")).toBe(true);
});

it("manager requires the specific enabled permission", () => {
  expect(hasPermission(manager, "inventory.stock_out")).toBe(true);
  expect(hasPermission(manager, "inventory.adjust")).toBe(false);
});
```

- [ ] **Step 2: Verify failure**

```powershell
npm run test:unit -- permissions.test.ts
```

Expected: FAIL because auth domain files do not exist.

- [ ] **Step 3: Implement exact Phase 1 permission domain**

```ts
export type UserRole = "admin" | "manager";
export type PermissionKey =
  | "inventory.view"
  | "inventory.stock_in"
  | "inventory.stock_out"
  | "inventory.adjust"
  | "inventory.view_cost"
  | "inventory.edit_global_price"
  | "reports.view_inventory_value";

export type UserAccessContext = {
  userId: string;
  role: UserRole;
  locationId: string | null;
  locationCode: "LON" | "REG" | null;
  permissions: ReadonlySet<PermissionKey>;
};
```

`hasPermission` returns true for Admin; Manager requires the key in `permissions`.

- [ ] **Step 4: Create identity/access migration**

Migration must create:

```sql
create extension if not exists pgcrypto;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('LON','REG')),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.locations(code,name) values ('LON','Lonsdale'),('REG','Regency Park');

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','manager')),
  location_id uuid references public.locations(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profile_location_ck check (
    (role='admin' and location_id is null) or
    (role='manager' and location_id is not null)
  )
);

create table public.manager_permissions (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default true,
  primary key(user_id,permission_key)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  actor_role text,
  location_id uuid references public.locations(id),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

Implement `app_is_admin`, `app_user_location_id`, and `app_has_permission` as `security definer`, `stable`, `search_path=public`, always requiring an active profile. Implement `app_audit_event` as `security definer` and derive actor from `auth.uid()`.

Enable RLS. Policies:

- `locations`: Admin reads both; Manager reads assigned location only.
- `user_profiles`: self or Admin reads.
- `manager_permissions`: self or Admin reads.
- `audit_events`: Admin all; Manager assigned-location rows only.
- authenticated has no direct insert/update/delete on `audit_events`.

- [ ] **Step 5: Prove branch RLS with integration test**

Create Admin, LON Manager, REG Manager in a disposable/local Supabase project. Sign each in with anon client and assert:

```ts
expect((await lon.from("locations").select("code")).data?.map(x => x.code)).toEqual(["LON"]);
expect((await reg.from("locations").select("code")).data?.map(x => x.code)).toEqual(["REG"]);
expect(new Set((await admin.from("locations").select("code")).data?.map(x => x.code))).toEqual(new Set(["LON", "REG"]));
```

Delete test Auth users in teardown.

- [ ] **Step 6: Run database and unit verification**

```powershell
npx supabase start
npx supabase db reset
npm run test:unit -- permissions.test.ts
npm run test:integration -- access-rls.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add inventory-app/lib/auth inventory-app/supabase inventory-app/tests
git commit -m "feat(inventory): add roles locations permissions and audit"
```

---

### Task 3: Add Supabase Sessions, Login, Admin Manager Invitations, and Fixed Location Scope

**Files:**
- Create: `inventory-app/lib/supabase/{browser.ts,server.ts,service.ts,proxy.ts}`
- Create: `inventory-app/proxy.ts`
- Create: `inventory-app/lib/auth/access.ts`
- Create: `inventory-app/lib/location/scope.ts`
- Create: `inventory-app/app/(auth)/login/{page.tsx,actions.ts}`
- Create: `inventory-app/app/(protected)/layout.tsx`
- Create: `inventory-app/app/(protected)/actions.ts`
- Create: `inventory-app/app/(protected)/settings/users/{page.tsx,actions.ts}`
- Create: `inventory-app/scripts/bootstrap-admin.ts`
- Create: `inventory-app/tests/unit/{access-context.test.ts,location-scope.test.ts}`

**Interfaces:**
- `createBrowserSupabaseClient()`.
- `createServerSupabaseClient()`.
- `createServiceSupabaseClient()` server-only.
- `getCurrentAccess(): Promise<UserAccessContext>`.
- `LocationScope = {kind:"all"}|{kind:"location";code:"LON"|"REG"}`.
- `resolveLocationScope(access,requested)`.

- [ ] **Step 1: Write failing access and scope tests**

```ts
it("inactive profile is rejected", () => {
  expect(() => mapAccessContext({ user_id: "u1", role: "manager", active: false, location_id: "l1", locations: { code: "LON" } }, [])).toThrow("ACCOUNT_DISABLED");
});

it("manager cannot change branch scope", () => {
  expect(resolveLocationScope({ role: "manager", locationCode: "LON" }, "REG")).toEqual({ kind: "location", code: "LON" });
});

it("admin can select all or one branch", () => {
  expect(resolveLocationScope({ role: "admin", locationCode: null }, "ALL")).toEqual({ kind: "all" });
  expect(resolveLocationScope({ role: "admin", locationCode: null }, "REG")).toEqual({ kind: "location", code: "REG" });
});
```

- [ ] **Step 2: Verify tests fail**

```powershell
npm run test:unit -- access-context.test.ts location-scope.test.ts
```

- [ ] **Step 3: Implement Supabase clients and Next.js 16 proxy**

- Browser client uses public URL/anon key.
- Server client uses `@supabase/ssr` plus Next cookies.
- Service client begins `import "server-only";` and requires `SUPABASE_SERVICE_ROLE_KEY`.
- Use Next.js 16 `proxy.ts`, not legacy `middleware.ts`, to refresh Supabase sessions.

`getCurrentAccess` loads Auth user, active profile, location code, enabled permissions; unauthenticated users redirect to `/login`.

- [ ] **Step 4: Implement login/logout**

Login validates email/password with Zod, uses `signInWithPassword`, audits `LOGIN_SUCCESS`, and redirects to `/dashboard`. Invalid credentials return exactly:

```ts
{ ok: false, error: "Email or password is incorrect." }
```

Logout calls `signOut()` and redirects to `/login`.

- [ ] **Step 5: Implement Admin scope cookie**

Server action accepts only `ALL|LON|REG`, requires Admin, stores `inventory_location_scope` as HTTP-only, SameSite=Lax, and revalidates protected layout. Managers never write/read this cookie for authorization; `resolveLocationScope` always returns their profile location.

- [ ] **Step 6: Implement Admin manager invitation**

Admin-only action accepts email, display name, LON/REG, and allowed Phase 1 permission keys. It calls service-role `auth.admin.inviteUserByEmail`, inserts profile and enabled permission rows, and records `MANAGER_INVITED` with Admin actor ID. If profile creation fails after invitation, delete the invited Auth user before returning the error.

- [ ] **Step 7: Implement bootstrap script**

`bootstrap-admin.ts` accepts `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME`, finds an already-created Auth user, and upserts:

```ts
{ user_id: user.id, display_name: name, role: "admin", location_id: null, active: true }
```

It never creates or prints a password.

- [ ] **Step 8: Verify**

```powershell
npm run test:unit -- access-context.test.ts location-scope.test.ts permissions.test.ts
npm run typecheck
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add inventory-app
git commit -m "feat(inventory): add login access context and manager invitations"
```

---

### Task 4: Build Responsive Desktop/Mobile App Shell

**Files:**
- Create: `inventory-app/components/shell/{app-shell.tsx,desktop-sidebar.tsx,mobile-nav.tsx,topbar.tsx}`
- Create: `inventory-app/components/location/location-scope-select.tsx`
- Create: `inventory-app/app/(protected)/dashboard/page.tsx`
- Create: `inventory-app/tests/unit/shell-navigation.test.tsx`

**Interfaces:**
- `AppShell` receives current `UserAccessContext` and resolved `LocationScope`.
- Protected pages render inside one shared shell.

- [ ] **Step 1: Write shell component test first**

Manager render must include Dashboard/Inventory/Stock In/Stock Out and must not include `All Locations`. Admin render must include `All Locations`, `Lonsdale`, `Regency Park`, and `Users`.

```ts
expect(screen.getByText("Dashboard")).toBeInTheDocument();
expect(screen.getByText("Inventory")).toBeInTheDocument();
expect(screen.queryByText("All Locations")).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify failure**

```powershell
npm run test:unit -- shell-navigation.test.tsx
```

- [ ] **Step 3: Implement desktop navigation**

Links:

- `/dashboard` Dashboard
- `/inventory` Inventory
- `/stock/in` Stock In when `inventory.stock_in`
- `/stock/out` Stock Out when `inventory.stock_out`
- `/stock/adjust` Adjust Stock when `inventory.adjust`
- `/settings/users` Users for Admin only

Use copied approved logo asset. Fixed sidebar at `lg` and above; no public-site hero/marketing animation.

- [ ] **Step 4: Implement mobile navigation**

Bottom nav below `lg`:

- Home → `/dashboard`
- Stock → `/inventory`
- Stock In → `/stock/in` when allowed
- Stock Out → `/stock/out` when allowed
- More → Sheet containing adjustment and Admin Users when allowed

Every touch action is at least 44px high; no hover-only control.

- [ ] **Step 5: Implement top bar and branch display**

Admin sees scope selector. Manager sees fixed branch name as non-interactive text. Add notifications icon visually but do not fabricate notification counts in Phase 1.

- [ ] **Step 6: Verify**

```powershell
npm run test:unit -- shell-navigation.test.tsx
npm run typecheck
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add inventory-app/app inventory-app/components inventory-app/tests/unit
git commit -m "feat(inventory): add responsive desktop and mobile shell"
```

---

### Task 5: Add Product Catalogue and Used-Tyre Data Model

**Files:**
- Create: `inventory-app/supabase/migrations/20260902091000_product_catalog.sql`
- Create: `inventory-app/lib/products/{types.ts,validation.ts,repository.ts}`
- Create: `inventory-app/app/(protected)/inventory/actions.ts`
- Create: `inventory-app/components/inventory/{product-form.tsx,product-table.tsx}`
- Create: `inventory-app/app/(protected)/inventory/page.tsx`
- Create: `inventory-app/app/(protected)/inventory/[productId]/page.tsx`
- Create: `inventory-app/tests/unit/product-validation.test.ts`
- Create: `inventory-app/tests/integration/product-rls.test.ts`

**Interfaces:**
- Tables: `product_categories`, `tyre_brands`, `tyre_patterns`, `tyre_sizes`, `products`, `used_tyre_units`, `inventory_settings`.
- `ProductInputSchema` and `UsedTyreUnitDraftSchema`.
- Product read/admin-write repository functions.
- Used-unit creation is intentionally deferred to Task 6 so an available individual unit can never exist without a matching stock movement.

- [ ] **Step 1: Write failing validation tests**

```ts
expect(ProductInputSchema.safeParse({
  name: "Michelin X Multi 295/80R22.5",
  category: "truck_tyre",
  sellingPriceInclGst: 685,
  tyre: { condition: "new", brand: "Michelin", pattern: "X Multi", size: "295/80R22.5", loadIndex: "152/148", speedRating: "M" }
}).success).toBe(true);

expect(ProductInputSchema.safeParse({ name: "Bad tyre", category: "truck_tyre", sellingPriceInclGst: -1 }).success).toBe(false);
expect(UsedTyreUnitDraftSchema.safeParse({ treadDepthMm: -2, condition: "good", costBasis: 100 }).success).toBe(false);
```

- [ ] **Step 2: Verify failure**

```powershell
npm run test:unit -- product-validation.test.ts
```

- [ ] **Step 3: Create catalogue schema**

Seed exactly these categories: `truck_tyre`, `rim_wheel`, `tube`, `valve`, `wheel_nut_stud`, `repair_material`, `balancing_weight`, `workshop_consumable`, `other_part`.

Core product schema:

```sql
create table public.tyre_brands (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null unique,
  display_name text not null
);
create table public.tyre_patterns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.tyre_brands(id),
  normalized_name text not null,
  display_name text not null,
  unique(brand_id, normalized_name)
);
create table public.tyre_sizes (
  id uuid primary key default gen_random_uuid(),
  normalized_size text not null unique,
  display_size text not null
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_code text not null references public.product_categories(code),
  part_reference text,
  selling_price_incl_gst numeric(14,2) not null check (selling_price_incl_gst >= 0),
  active boolean not null default true,
  tyre_condition text check (tyre_condition in ('new','used')),
  tyre_brand_id uuid references public.tyre_brands(id),
  tyre_pattern_id uuid references public.tyre_patterns(id),
  tyre_size_id uuid references public.tyre_sizes(id),
  load_index text,
  speed_rating text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.used_tyre_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.locations(id),
  internal_unit_code text not null unique,
  tread_depth_mm numeric(5,2) not null check (tread_depth_mm >= 0),
  condition text not null check (condition in ('excellent','good','fair','scrap')),
  cost_basis numeric(14,4) not null check (cost_basis >= 0),
  selling_price_override numeric(14,2) check (selling_price_override >= 0),
  status text not null check (status in ('available','reserved','sold','scrap')),
  notes text,
  created_at timestamptz not null default now()
);
create table public.inventory_settings (
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  reorder_quantity integer not null default 0 check (reorder_quantity >= 0),
  primary key(product_id, location_id)
);
```

Add constraint that truck tyres require condition/brand/size. Enable RLS: product master read for authenticated active users; Admin-only product creation/archive in Phase 1; used-unit reads Admin-all/Manager-own-branch; direct used-unit inserts are revoked because Task 6 will create units atomically with stock.

- [ ] **Step 4: Implement normalisation and product writes**

```ts
export function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
```

Admin `createProduct` validates input, upserts normalised brand/pattern/size for tyres, inserts product, inserts zeroed `inventory_settings` rows for LON and REG, and audits `PRODUCT_CREATED`.

- [ ] **Step 5: Build catalogue screens**

`/inventory` filters by free text, category, tyre condition, brand, size, and active state. Admin sees `New Product`; Manager read-only. Product detail shows master data and used-unit list permitted by RLS; no button can create an available used unit until Task 6 lands.

- [ ] **Step 6: Prove catalogue RLS**

Integration test asserts both Managers can read global product master; LON Manager cannot read a REG used-unit row; Manager cannot insert product; Admin can insert product and see both branches' used-unit rows.

- [ ] **Step 7: Verify and commit**

```powershell
npx supabase db reset
npm run test:unit -- product-validation.test.ts
npm run test:integration -- product-rls.test.ts
npm run typecheck
npm run build
```

```bash
git add inventory-app
git commit -m "feat(inventory): add product and tyre catalogue"
```

---

### Task 6: Add Atomic Inventory Ledger, WAC, No-Negative Stock, and Individual Used-Tyre Intake

**Files:**
- Create: `inventory-app/supabase/migrations/20260902092000_inventory_ledger.sql`
- Create: `inventory-app/lib/inventory/{types.ts,repository.ts}`
- Create: `inventory-app/tests/integration/{inventory-rpc.test.ts,inventory-concurrency.test.ts,used-tyre-intake.test.ts}`

**Interfaces:**
- Tables: `inventory_balances`, `inventory_movements`.
- RPC: `post_inventory_movement(...)`.
- RPC: `set_inventory_count(...)`.
- RPC: `create_used_tyre_unit_with_stock(...)`.
- `InventoryMutationResult = {movementId,onHand,reserved,available,weightedAverageCost}`.

- [ ] **Step 1: Write failing WAC/idempotency tests**

For one LON product:

1. +10 Quick Stock-In at 400 → on hand 10, WAC 400.
2. +10 at 500 → on hand 20, WAC 450.
3. -2 Stock-Out → on hand 18, WAC 450.
4. -19 → error `INSUFFICIENT_STOCK`, balance remains 18.
5. Re-submit step 3's same `request_id` → no second movement.

- [ ] **Step 2: Verify failure**

```powershell
npm run test:integration -- inventory-rpc.test.ts
```

- [ ] **Step 3: Create ledger tables and RLS**

```sql
create table public.inventory_balances (
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.locations(id),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  weighted_average_cost numeric(14,4) not null default 0 check (weighted_average_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key(product_id,location_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  product_id uuid not null references public.products(id),
  used_tyre_unit_id uuid references public.used_tyre_units(id),
  location_id uuid not null references public.locations(id),
  quantity_delta integer not null check (quantity_delta <> 0),
  movement_type text not null check (movement_type in ('quick_stock_in','stock_out','adjustment','used_unit_in','used_unit_out')),
  reason text,
  source_type text,
  source_id text,
  inbound_unit_cost numeric(14,4),
  cost_snapshot numeric(14,4) not null,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
```

Insert zero balance rows for every existing product × both locations, then add an after-product-insert trigger using `ON CONFLICT DO NOTHING` for future zero balances. Zero initialization is not a stock movement.

RLS: Admin reads both locations; Manager reads assigned location. Revoke authenticated direct INSERT/UPDATE/DELETE on balances and movements.

- [ ] **Step 4: Implement `post_inventory_movement`**

Signature:

```sql
post_inventory_movement(
  p_request_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity_delta integer,
  p_movement_type text,
  p_reason text default null,
  p_inbound_unit_cost numeric default null,
  p_used_tyre_unit_id uuid default null,
  p_source_type text default null,
  p_source_id text default null
)
returns table(movement_id uuid,on_hand integer,reserved integer,available integer,weighted_average_cost numeric)
```

Inside one transaction/function:

1. require active authenticated profile;
2. Admin may target either branch; Manager target must equal profile branch;
3. map permissions: `quick_stock_in|used_unit_in` → `inventory.stock_in`; `stock_out|used_unit_out` → `inventory.stock_out`; `adjustment` → `inventory.adjust`;
4. if `request_id` already exists, do not insert another movement and return current balance;
5. lock balance row `FOR UPDATE`;
6. reject `new_on_hand < 0` or `new_on_hand < reserved` with `INSUFFICIENT_STOCK`;
7. positive Quick Stock-In requires non-negative unit cost and recalculates WAC: `((old_qty*old_wac)+(in_qty*cost))/new_qty`;
8. outbound/adjustment movement preserves WAC; outbound `cost_snapshot` is current WAC;
9. insert movement and update balance;
10. audit before/after values, reason, movement ID;
11. return result.

- [ ] **Step 5: Implement absolute adjustment RPC**

`set_inventory_count(request_id,product_id,location_id,counted_quantity,reason,notes)` requires Admin or `inventory.adjust`; reason non-empty; locks balance; rejects counted quantity below reserved; computes delta; rejects zero delta with `NO_STOCK_CHANGE`; preserves WAC; inserts one adjustment movement and audit event.

- [ ] **Step 6: Implement atomic individual used-tyre intake**

`create_used_tyre_unit_with_stock(...)` requires Admin or `inventory.stock_in`. It validates product is `truck_tyre` + `used`, target branch authorization, tread depth/condition/cost, allocates `UT-000001` style code using a DB sequence, inserts `used_tyre_units` with `status='available'`, then posts a `+1 used_unit_in` movement with that same unit ID and cost. If movement posting fails, unit insert rolls back in the same transaction.

This is the only Phase 1 path that creates an available individual used tyre; there is no period where an available unit exists without stock ledger quantity.

- [ ] **Step 7: Write concurrency test**

Seed on hand `2`; launch two stock-outs concurrently (`-2` and `-1`). Assert exactly one succeeds, exactly one fails, and:

```ts
const successfulDelta = calls.find(c => c.ok)!.delta;
expect(finalBalance.on_hand).toBe(2 + successfulDelta);
expect(finalBalance.on_hand).toBeGreaterThanOrEqual(0);
```

- [ ] **Step 8: Write used-unit atomicity test**

Successful intake creates exactly one used-unit row, one +1 movement linked to the unit, and one extra on-hand. Invalid/unauthorized intake creates neither row nor movement.

- [ ] **Step 9: Implement repository adapter and friendly errors**

Export:

```ts
postInventoryMovement(client,input): Promise<InventoryMutationResult>
setInventoryCount(client,input): Promise<InventoryMutationResult>
createUsedTyreUnitWithStock(client,input): Promise<{unitId:string;unitCode:string;inventory:InventoryMutationResult}>
getInventoryBalance(client,productId,locationId): Promise<InventoryBalance>
```

Map DB errors:

- `INSUFFICIENT_STOCK` → `Cannot remove this quantity. Available stock has changed.`
- `ACCESS_DENIED` → `You do not have permission for this stock action.`
- `NO_STOCK_CHANGE` → `The counted quantity is already correct.`

- [ ] **Step 10: Verify and commit**

```powershell
npx supabase db reset
npm run test:integration -- inventory-rpc.test.ts inventory-concurrency.test.ts used-tyre-intake.test.ts
npm run typecheck
```

```bash
git add inventory-app
git commit -m "feat(inventory): add atomic stock ledger and weighted cost"
```

---

### Task 7: Build Stock In, Stock Out, Adjustment, Individual Used-Tyre Intake, Inventory Search, and Low Stock UI

**Files:**
- Create: `inventory-app/lib/inventory/{validation.ts,queries.ts,low-stock.ts}`
- Create: `inventory-app/supabase/migrations/20260902093000_inventory_summary.sql`
- Create: `inventory-app/app/(protected)/stock/actions.ts`
- Create: `inventory-app/components/stock/{product-picker.tsx,stock-in-form.tsx,stock-out-form.tsx,stock-adjustment-form.tsx,used-tyre-intake-form.tsx}`
- Create: `inventory-app/components/inventory/{inventory-table.tsx,inventory-mobile-list.tsx,low-stock-card.tsx,reorder-settings-form.tsx}`
- Modify: `inventory-app/app/(protected)/stock/{in,out,adjust}/page.tsx`
- Modify: `inventory-app/app/(protected)/inventory/{page.tsx,[productId]/page.tsx}`
- Modify: `inventory-app/app/(protected)/dashboard/page.tsx`
- Create: `inventory-app/tests/unit/{stock-validation.test.ts,low-stock.test.ts,stock-form.test.tsx}`
- Create: `inventory-app/tests/integration/inventory-summary.test.ts`

**Interfaces:**
- Schemas: `StockInSchema`, `StockOutSchema`, `StockAdjustmentSchema`, `UsedTyreIntakeSchema`.
- Server actions: `stockInAction`, `stockOutAction`, `adjustStockAction`, `usedTyreIntakeAction`, `updateReorderSettingsAction`.
- View: `inventory_product_summary` with `security_invoker=true`.
- Queries: `searchInventory`, `getDashboardInventoryMetrics`.

- [ ] **Step 1: Write failing validation and low-stock tests**

```ts
expect(StockInSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), quantity: 12, unitCost: 445 }).success).toBe(true);
expect(StockInSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), quantity: 0, unitCost: 445 }).success).toBe(false);
expect(StockOutSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), quantity: 2, reason: "damaged" }).success).toBe(true);
expect(StockAdjustmentSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), countedQuantity: 13, reason: "physical_count_correction" }).success).toBe(true);
expect(isLowStock({ available: 4, minimumStock: 6 })).toBe(true);
expect(isLowStock({ available: 6, minimumStock: 6 })).toBe(false);
```

Allowed Stock-Out reasons: `damaged`, `write_off`, `internal_use`, `missing`, `data_correction`, `warranty_return`, `supplier_return`, `other`.

- [ ] **Step 2: Verify failure**

```powershell
npm run test:unit -- stock-validation.test.ts low-stock.test.ts
```

- [ ] **Step 3: Create location-safe inventory summary view**

```sql
create view public.inventory_product_summary
with (security_invoker = true)
as
select
  p.id product_id,
  p.name,
  p.category_code,
  p.part_reference,
  p.selling_price_incl_gst,
  p.tyre_condition,
  b.location_id,
  l.code location_code,
  l.name location_name,
  b.on_hand,
  b.reserved,
  (b.on_hand-b.reserved) available,
  b.weighted_average_cost,
  coalesce(s.minimum_stock,0) minimum_stock,
  coalesce(s.reorder_quantity,0) reorder_quantity,
  ((b.on_hand-b.reserved) < coalesce(s.minimum_stock,0)) low_stock
from public.products p
join public.inventory_balances b on b.product_id=p.id
join public.locations l on l.id=b.location_id
left join public.inventory_settings s on s.product_id=p.id and s.location_id=b.location_id
where p.active;
```

Grant SELECT to authenticated. Add useful indexes on product name/reference, tyre lookup normalized values, and movement `(location_id,created_at desc)`.

- [ ] **Step 4: Implement stock server actions**

Each action:

1. `getCurrentAccess()`;
2. exact permission check;
3. Manager branch fixed to assigned location; Admin may choose LON/REG;
4. Zod validation;
5. user-scoped RPC call;
6. `revalidatePath` for dashboard, inventory, and product detail;
7. friendly typed result.

Use action result:

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string,string[]> };
```

Every form submission carries a UUID request ID and disables the primary button while pending.

- [ ] **Step 5: Build mobile-first forms**

Common rules:

- searchable Product Picker;
- show On Hand / Reserved / Available before mutation;
- Manager branch is read-only; Admin branch selector;
- minimum 44px touch controls;
- no QR/barcode control;
- success state shows updated quantity; WAC only when authorized;
- Stock-Out client blocks quantity above displayed Available, while RPC rechecks server-side;
- adjustment field label is `Counted Quantity` and reason is mandatory;
- used-tyre intake collects tread depth, condition, cost basis, optional unit-specific selling price, notes, and creates stock only through Task 6 RPC.

- [ ] **Step 6: Implement search and low-stock queries**

`searchInventory` filters free text over product name/reference/brand/pattern/size, category, New/Used, Low Stock, and current scope. Manager queries return only assigned location via RLS. Admin `All` returns both rows.

`getDashboardInventoryMetrics` returns:

```ts
{
  activeProducts: number;
  totalOnHand: number;
  lowStockItems: number;
  inventoryValue: number | null;
  recentMovements: RecentMovement[];
}
```

Manager without `reports.view_inventory_value` gets `inventoryValue:null`; Manager without `inventory.view_cost` never receives/renders WAC.

- [ ] **Step 7: Implement responsive inventory UI**

Desktop Admin All columns: Product, category/condition, Lonsdale qty, Regency Park qty, Sell Price, Low Stock, WAC only when authorized. Branch-scoped/Manager view shows single Available quantity. Mobile uses cards with product, tyre metadata, available qty, sell price, status badge; product detail exposes permitted Stock In/Out/Adjustment and individual used-tyre intake actions.

- [ ] **Step 8: Implement Admin reorder settings**

Admin-only product detail form edits `minimum_stock` and `reorder_quantity` separately for LON and REG. Manager can view their branch thresholds but cannot edit in Phase 1.

- [ ] **Step 9: Prove location-specific low stock**

Integration seed:

- LON product A: available 4, minimum 6 → Low Stock.
- REG product A: available 15, minimum 6 → Healthy.

Assert LON Manager sees only LON low=true; REG Manager only REG low=false; Admin All sees both.

- [ ] **Step 10: Verify and commit**

```powershell
npx supabase db reset
npm run test:unit -- stock-validation.test.ts low-stock.test.ts stock-form.test.tsx
npm run test:integration -- inventory-summary.test.ts
npm run typecheck
npm run build
```

```bash
git add inventory-app
git commit -m "feat(inventory): add stock workflows search and low-stock dashboard"
```

---

### Task 8: Add E2E Security Checks, CI, and Deployment Documentation

**Files:**
- Create: `inventory-app/tests/e2e/{global.setup.ts,auth.spec.ts,inventory-manager.spec.ts,inventory-admin.spec.ts,mobile-stock.spec.ts}`
- Create: `.github/workflows/inventory.yml`
- Create: `inventory-app/README.md`
- Create: `docs/inventory-phase-1-deployment.md`

**Interfaces:**
- Produces repeatable disposable test users and Phase 1 acceptance tests.
- Produces CI gate and exact separate Vercel/Supabase deployment instructions.

- [ ] **Step 1: Seed deterministic E2E users**

Test/staging only:

- `inventory-admin@test.local` → Admin.
- `inventory-lon@test.local` → LON Manager with view/stock-in/stock-out/adjust/view-cost/inventory-value.
- `inventory-reg@test.local` → REG Manager with view/stock-in/stock-out/adjust and no cost/value permission.

Create/delete them with test service role in global setup. Never use production credentials.

- [ ] **Step 2: Test authentication and branch isolation**

Assert unauthenticated `/dashboard` redirects to `/login`; Admin valid login works; wrong password shows exact friendly error. LON Manager sees `Lonsdale`, no All Locations selector, cannot use Admin Users page, and cannot expose REG-only rows through direct navigation.

- [ ] **Step 3: Test complete Phase 1 stock flow**

As LON Manager:

1. Quick Stock-In 10 @ 400.
2. Quick Stock-In 10 @ 500.
3. verify on hand 20 and WAC 450.
4. Stock-Out 2 damaged → on hand 18, WAC 450.
5. Stock-Out 19 → blocked with friendly error.
6. adjust counted qty to 17 with reason `Physical count correction`.
7. verify movement history contains each successful change and adjustment reason.
8. intake one individual used tyre and verify unit code, +1 movement, and updated balance.

- [ ] **Step 4: Test Admin and restricted-cost behavior**

Admin sees All/LON/REG, separate branch quantities, reorder setting edits, and Users. REG Manager cannot see WAC or inventory value.

- [ ] **Step 5: Test mobile viewport**

At `390x844`: desktop sidebar hidden; bottom nav visible; Stock In/Out/Adjustment forms do not overflow; buttons usable without hover; no QR/barcode control; successful action displays updated quantity.

- [ ] **Step 6: Add CI**

`.github/workflows/inventory.yml` uses Node 22 and `working-directory: inventory-app`:

```yaml
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm run test:unit
- run: npm run build
```

A second job runs integration/E2E only when disposable test Supabase secrets are configured.

- [ ] **Step 7: Document setup/deployment**

`inventory-app/README.md` local commands:

```powershell
Set-Location -LiteralPath .\inventory-app
Copy-Item .env.example .env.local
npm install
npx supabase start
npx supabase db reset
npm run dev
```

Deployment doc requirements:

- separate Vercel project;
- Vercel Root Directory = `inventory-app`;
- separate inventory Supabase project, not public website production DB;
- inventory migration directory applied in order;
- public Supabase URL/anon key and server-only service role configured;
- first Admin Auth user created then bootstrap script run;
- service key never uses `NEXT_PUBLIC_` prefix.

- [ ] **Step 8: Run complete acceptance gate**

Inventory app:

```powershell
Set-Location -LiteralPath .\inventory-app
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Then verify the public site remains unaffected:

```powershell
Set-Location -LiteralPath ..
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 9: Commit**

```bash
git add inventory-app .github/workflows/inventory.yml docs/inventory-phase-1-deployment.md
git commit -m "test(inventory): verify phase 1 security and deployment"
```

---

## Phase 1 Completion Gate

Phase 1 is complete only when:

- public marketing app and `inventory-app/` build independently;
- email/password login works;
- Admin sees All/LON/REG; Managers are fixed to one branch;
- RLS tests prove branch isolation under direct queries;
- Admin can invite Managers and assign Phase 1 permissions;
- all approved inventory categories exist;
- new/used tyre master data uses normalised brand/pattern/size values;
- grouped inventory and individual used tyres both work;
- an available individual used tyre cannot exist without its corresponding inventory movement;
- no barcode/QR controls exist;
- every non-zero posted stock change has movement + audit history;
- WAC updates only on eligible inbound stock and is separate per branch;
- negative stock and concurrent oversell are blocked;
- duplicate request IDs do not double-post;
- adjustments require reason;
- Low Stock means `Available < Minimum` separately for LON and REG;
- global sell price remains one product value;
- cost/value visibility respects permissions;
- desktop and mobile workflows pass E2E;
- lint, typecheck, unit, integration, build, and E2E checks pass;
- Vercel uses `inventory-app` root and a separate inventory Supabase project.

## Deferred to Later Plans

1. Suppliers, purchase orders, Admin approval, goods receipts, suggested reorder POs.
2. Inter-location transfer request/approval/dispatch/receive/discrepancy flow.
3. Full stocktake workflow.
4. Customers, fleet accounts, vehicles.
5. Quotes, jobs, reservations, POS.
6. Invoices, terms, receivables, refunds, Stripe.
7. Resend transactional/reminder emails.
8. Full sales/GST/profit/customer/supplier/transfer reports and exports.
9. Broader notification centre and final production PWA polish.
