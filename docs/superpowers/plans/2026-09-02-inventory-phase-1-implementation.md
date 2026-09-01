# 24/7 Inventory Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first production-capable slice of the standalone 24/7 Truck Tyre Services inventory application: authenticated Admin/Manager access, Lonsdale/Regency Park isolation, responsive PC/mobile shell, product and new/used tyre catalogue, append-only inventory ledger, Stock In/Out, stock adjustments, location-specific weighted-average cost, and low-stock management.

**Architecture:** Keep the existing public website untouched. Build the inventory system as an independent Next.js application in `inventory-app/`, with its own package manifest, environment variables, Vercel root directory, and Supabase project/migrations. Normal authenticated operations use a user-scoped Supabase client and database RLS/RPCs; the service-role client is restricted to Admin-only user provisioning. Inventory mutations are atomic PostgreSQL RPCs so authorization, no-negative-stock enforcement, movement creation, WAC updates, balance updates, and audit writes commit together.

**Tech Stack:** Node.js 22.x, Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui, Supabase PostgreSQL/Auth/Storage, Vitest, Testing Library, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-02-inventory-software-design.md`

## Global Constraints

- The inventory application is a separate authenticated application/deployment and must not be mixed into public marketing routes.
- Node.js remains `22.x`; Next.js remains major version `16`; React remains major version `19`; TypeScript remains major version `5`; Tailwind remains major version `4`.
- Initial locations are exactly `Lonsdale` (`LON`) and `Regency Park` (`REG`).
- Admin can access both locations; a Manager is assigned to exactly one location and cannot switch branch scope.
- Manager permissions are custom, but Admin-only controls remain hard Admin-only.
- No barcode or QR workflow is included.
- New tyres are normally quantity-tracked; used tyres support grouped stock plus individually tracked units.
- Selling price is global and GST-inclusive; WAC is location-specific.
- Negative stock is never allowed.
- Every posted stock change creates an append-only movement and audit event.
- Quick Stock-In, Stock-Out, and manual stock adjustment are permission-controlled.
- Phase 1 is online-only; do not add offline mutation queues or sync logic.
- Do not add purchasing, transfers, customers, jobs, quotes, invoicing, Stripe, Resend reminders, or accounting reports in this plan; those belong to later implementation plans.

---

## File Structure Locked for Phase 1

The public site remains at repository root. New inventory code lives under `inventory-app/`.

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
│   ├── (auth)/login/page.tsx
│   └── (protected)/
│       ├── layout.tsx
│       ├── dashboard/page.tsx
│       ├── inventory/page.tsx
│       ├── inventory/[productId]/page.tsx
│       ├── stock/in/page.tsx
│       ├── stock/out/page.tsx
│       ├── stock/adjust/page.tsx
│       └── settings/users/page.tsx
├── components/
│   ├── shell/
│   ├── inventory/
│   ├── stock/
│   ├── location/
│   └── ui/                 # shadcn generated components
├── lib/
│   ├── app-config.ts
│   ├── auth/
│   ├── location/
│   ├── products/
│   ├── inventory/
│   └── supabase/
├── public/
│   └── brand/              # copy existing approved brand assets from root public/brand
├── scripts/
│   └── bootstrap-admin.ts
├── supabase/
│   ├── config.toml
│   ├── seed.sql
│   └── migrations/
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/

.github/workflows/inventory.yml
```

Boundary rules:

- `lib/auth` owns roles, permissions, current-user access context, and authorization checks.
- `lib/location` owns Admin scope selection and Manager fixed-scope resolution.
- `lib/products` owns catalogue types, validation, reads, and product creation/update commands.
- `lib/inventory` owns stock mutation inputs/results, inventory queries, WAC display helpers, and RPC adapters.
- PostgreSQL owns authoritative stock mutation logic; TypeScript must not reimplement balance/WAC arithmetic for writes.
- React components receive typed domain data and must not directly construct privileged Supabase service-role clients.

---

### Task 1: Scaffold the Standalone Inventory Application and Test Harness

**Files:**
- Create: `inventory-app/package.json`
- Create: `inventory-app/tsconfig.json`
- Create: `inventory-app/next.config.ts`
- Create: `inventory-app/postcss.config.mjs`
- Create: `inventory-app/vitest.config.ts`
- Create: `inventory-app/playwright.config.ts`
- Create: `inventory-app/.env.example`
- Create: `inventory-app/app/layout.tsx`
- Create: `inventory-app/app/globals.css`
- Create: `inventory-app/app/manifest.ts`
- Create: `inventory-app/lib/app-config.ts`
- Create: `inventory-app/tests/unit/app-config.test.ts`
- Copy: `public/brand/logo-real-horizontal.png` → `inventory-app/public/brand/logo-real-horizontal.png`
- Copy: `public/brand/logo-real-mark.png` → `inventory-app/public/brand/logo-real-mark.png`

**Interfaces:**
- Produces: `APP_NAME`, `LOCATION_CODES`, `LocationCode` from `lib/app-config.ts`.
- Produces: a standalone dev server at `http://localhost:3100`.
- Produces: Vitest and Playwright commands used by every later task.

- [ ] **Step 1: Create the standalone package and install the approved stack**

Create `inventory-app/package.json`:

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

Expected: dependencies install and `components/ui/*` plus `lib/utils.ts` are generated inside `inventory-app`.

- [ ] **Step 2: Write the first failing configuration test**

Create `tests/unit/app-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APP_NAME, LOCATION_CODES } from "../../lib/app-config";

describe("inventory app config", () => {
  it("uses the approved app name and exactly two initial location codes", () => {
    expect(APP_NAME).toBe("24/7 Inventory");
    expect(LOCATION_CODES).toEqual(["LON", "REG"]);
  });
});
```

- [ ] **Step 3: Run the unit test and verify it fails**

Run:

```powershell
npm run test:unit -- app-config.test.ts
```

Expected: FAIL because `lib/app-config.ts` does not exist.

- [ ] **Step 4: Implement the minimal app config and Next.js shell**

Create `lib/app-config.ts`:

```ts
export const APP_NAME = "24/7 Inventory" as const;
export const LOCATION_CODES = ["LON", "REG"] as const;
export type LocationCode = (typeof LOCATION_CODES)[number];
```

Create `app/layout.tsx` with metadata `24/7 Inventory`, import `globals.css`, and render children. Create `app/manifest.ts` returning a PWA manifest with name/short_name `24/7 Inventory`, `display: "standalone"`, `start_url: "/dashboard"`, and the copied mark icon. Keep `globals.css` limited to Tailwind import and application-level background/text variables; do not copy the public site's 70k-line marketing stylesheet.

Create `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_INVENTORY_APP_URL=http://localhost:3100
```

- [ ] **Step 5: Run unit, type, lint, and build checks**

Run:

```powershell
npm run test:unit
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit the standalone foundation**

```bash
git add inventory-app
git commit -m "feat(inventory): scaffold standalone app"
```

---

### Task 2: Create Identity, Locations, Permissions, and Audit Schema

**Files:**
- Create: `inventory-app/supabase/config.toml`
- Create: `inventory-app/supabase/migrations/20260902090000_identity_locations_permissions.sql`
- Create: `inventory-app/supabase/seed.sql`
- Create: `inventory-app/lib/auth/permissions.ts`
- Create: `inventory-app/lib/auth/types.ts`
- Create: `inventory-app/tests/unit/permissions.test.ts`
- Create: `inventory-app/tests/integration/access-rls.test.ts`

**Interfaces:**
- Produces DB tables: `locations`, `user_profiles`, `manager_permissions`, `audit_events`.
- Produces DB helpers: `app_is_admin()`, `app_user_location_id()`, `app_has_permission(text)`, `app_audit_event(text,text,jsonb)`.
- Produces TS types: `UserRole`, `PermissionKey`, `UserAccessContext`.
- Produces pure helper: `hasPermission(access, key): boolean`.

- [ ] **Step 1: Write failing permission-domain tests**

Create `tests/unit/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hasPermission } from "../../lib/auth/permissions";
import type { UserAccessContext } from "../../lib/auth/types";

const manager: UserAccessContext = {
  userId: "00000000-0000-0000-0000-000000000001",
  role: "manager",
  locationId: "10000000-0000-0000-0000-000000000001",
  locationCode: "LON",
  permissions: new Set(["inventory.view", "inventory.stock_out"]),
};

it("admin always passes operational permission checks", () => {
  const admin: UserAccessContext = { ...manager, role: "admin", locationId: null, locationCode: null, permissions: new Set() };
  expect(hasPermission(admin, "inventory.adjust")).toBe(true);
});

it("manager requires an enabled permission", () => {
  expect(hasPermission(manager, "inventory.stock_out")).toBe(true);
  expect(hasPermission(manager, "inventory.adjust")).toBe(false);
});
```

- [ ] **Step 2: Run the permission test and verify it fails**

```powershell
npm run test:unit -- permissions.test.ts
```

Expected: FAIL because auth types/helpers do not exist.

- [ ] **Step 3: Implement exact permission types and helper**

Create `lib/auth/types.ts`:

```ts
import type { LocationCode } from "../app-config";

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
  locationCode: LocationCode | null;
  permissions: ReadonlySet<PermissionKey>;
};
```

Create `lib/auth/permissions.ts`:

```ts
import type { PermissionKey, UserAccessContext } from "./types";

export function hasPermission(access: UserAccessContext, key: PermissionKey): boolean {
  return access.role === "admin" || access.permissions.has(key);
}
```

- [ ] **Step 4: Write the identity/location migration**

Create `supabase/migrations/20260902090000_identity_locations_permissions.sql` with:

```sql
create extension if not exists pgcrypto;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('LON','REG')),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.locations (code, name) values
  ('LON', 'Lonsdale'),
  ('REG', 'Regency Park');

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','manager')),
  location_id uuid references public.locations(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profile_location_ck check (
    (role = 'admin' and location_id is null) or
    (role = 'manager' and location_id is not null)
  )
);

create table public.manager_permissions (
  user_id uuid not null references public.user_profiles(user_id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default true,
  primary key (user_id, permission_key)
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

create or replace function public.app_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.user_id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

create or replace function public.app_user_location_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.location_id from public.user_profiles p
  where p.user_id = auth.uid() and p.active;
$$;

create or replace function public.app_has_permission(p_key text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.app_is_admin() or exists (
    select 1
    from public.manager_permissions mp
    join public.user_profiles p on p.user_id = mp.user_id
    where mp.user_id = auth.uid()
      and p.active
      and p.role = 'manager'
      and mp.permission_key = p_key
      and mp.enabled
  );
$$;

create or replace function public.app_audit_event(
  p_event_type text,
  p_entity_type text,
  p_entity_id text default null,
  p_details jsonb default '{}'::jsonb,
  p_location_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_role text;
begin
  select role into v_role from public.user_profiles
  where user_id = auth.uid() and active;
  if v_role is null then raise exception 'ACCESS_DENIED'; end if;

  insert into public.audit_events(actor_user_id, actor_role, location_id, event_type, entity_type, entity_id, details)
  values(auth.uid(), v_role, coalesce(p_location_id, public.app_user_location_id()), p_event_type, p_entity_type, p_entity_id, p_details)
  returning id into v_id;
  return v_id;
end;
$$;

alter table public.locations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.manager_permissions enable row level security;
alter table public.audit_events enable row level security;

create policy locations_read on public.locations for select to authenticated
using (public.app_is_admin() or id = public.app_user_location_id());

create policy profile_read_self_or_admin on public.user_profiles for select to authenticated
using (user_id = auth.uid() or public.app_is_admin());

create policy manager_permissions_read_self_or_admin on public.manager_permissions for select to authenticated
using (user_id = auth.uid() or public.app_is_admin());

create policy audit_read_admin_or_own_location on public.audit_events for select to authenticated
using (public.app_is_admin() or location_id = public.app_user_location_id());

revoke insert, update, delete on public.audit_events from authenticated;
```

Do not create direct insert/update policies for `audit_events`; writes go through audited security-definer functions.

- [ ] **Step 5: Add the integration test that proves branch isolation**

Create `tests/integration/access-rls.test.ts`. Use `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`; create one Admin, one Lonsdale Manager, one Regency Park Manager via the service client in `beforeAll`, insert corresponding profiles/permissions, sign in each user through an anon client, and assert:

```ts
expect((await lon.from("locations").select("code")).data?.map(x => x.code)).toEqual(["LON"]);
expect((await reg.from("locations").select("code")).data?.map(x => x.code)).toEqual(["REG"]);
expect(new Set((await admin.from("locations").select("code")).data?.map(x => x.code))).toEqual(new Set(["LON", "REG"]));
```

The test teardown deletes the three auth users through the service client.

- [ ] **Step 6: Reset a disposable Supabase project and run tests**

Run against local/disposable Supabase only:

```powershell
npx supabase start
npx supabase db reset
npm run test:unit -- permissions.test.ts
npm run test:integration -- access-rls.test.ts
```

Expected: permission unit tests PASS; RLS test proves the two managers can read only their branch and Admin can read both.

- [ ] **Step 7: Commit identity and access schema**

```bash
git add inventory-app/lib/auth inventory-app/supabase inventory-app/tests/unit/permissions.test.ts inventory-app/tests/integration/access-rls.test.ts
git commit -m "feat(inventory): add roles locations and permissions"
```

---

### Task 3: Implement Supabase Session Handling, Login, and Admin Manager Provisioning

**Files:**
- Create: `inventory-app/lib/supabase/browser.ts`
- Create: `inventory-app/lib/supabase/server.ts`
- Create: `inventory-app/lib/supabase/service.ts`
- Create: `inventory-app/lib/supabase/proxy.ts`
- Create: `inventory-app/proxy.ts`
- Create: `inventory-app/lib/auth/access.ts`
- Create: `inventory-app/app/(auth)/login/actions.ts`
- Create: `inventory-app/app/(auth)/login/page.tsx`
- Create: `inventory-app/app/(protected)/layout.tsx`
- Create: `inventory-app/app/(protected)/settings/users/actions.ts`
- Create: `inventory-app/app/(protected)/settings/users/page.tsx`
- Create: `inventory-app/scripts/bootstrap-admin.ts`
- Create: `inventory-app/tests/unit/access-context.test.ts`

**Interfaces:**
- Produces: `createBrowserSupabaseClient()`.
- Produces: `createServerSupabaseClient()` using request cookies.
- Produces: `createServiceSupabaseClient()` server-only.
- Produces: `getCurrentAccess(): Promise<UserAccessContext>`; redirects/throws for disabled/missing profiles.
- Produces Admin action `inviteManager(input)`.

- [ ] **Step 1: Write failing current-access mapping tests**

Create `tests/unit/access-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapAccessContext } from "../../lib/auth/access";

it("maps an active manager to one fixed location and enabled permissions", () => {
  const result = mapAccessContext(
    { user_id: "u1", role: "manager", active: true, location_id: "l1", locations: { code: "LON" } },
    [{ permission_key: "inventory.view", enabled: true }, { permission_key: "inventory.adjust", enabled: false }]
  );
  expect(result.locationCode).toBe("LON");
  expect([...result.permissions]).toEqual(["inventory.view"]);
});

it("rejects inactive profiles", () => {
  expect(() => mapAccessContext({ user_id: "u1", role: "manager", active: false, location_id: "l1", locations: { code: "LON" } }, [])).toThrow("ACCOUNT_DISABLED");
});
```

- [ ] **Step 2: Run and verify the mapping test fails**

```powershell
npm run test:unit -- access-context.test.ts
```

Expected: FAIL because `mapAccessContext` does not exist.

- [ ] **Step 3: Implement Supabase clients and access-context mapping**

`lib/supabase/browser.ts` uses `createBrowserClient` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

`lib/supabase/server.ts` uses `createServerClient` and Next.js `cookies()`; cookie writes are guarded because Server Components may be read-only.

`lib/supabase/service.ts` begins with `import "server-only";`, requires `SUPABASE_SERVICE_ROLE_KEY`, and is never imported from a client component.

Implement in `lib/auth/access.ts`:

```ts
export function mapAccessContext(profile: ProfileRow, permissions: PermissionRow[]): UserAccessContext {
  if (!profile.active) throw new Error("ACCOUNT_DISABLED");
  if (profile.role === "manager" && (!profile.location_id || !profile.locations?.code)) throw new Error("INVALID_MANAGER_LOCATION");
  return {
    userId: profile.user_id,
    role: profile.role,
    locationId: profile.role === "admin" ? null : profile.location_id,
    locationCode: profile.role === "admin" ? null : profile.locations!.code,
    permissions: new Set(permissions.filter(p => p.enabled).map(p => p.permission_key)),
  };
}
```

`getCurrentAccess()` gets the authenticated user, reads `user_profiles` plus location code and `manager_permissions` with the user-scoped client, redirects to `/login` when unauthenticated, and throws a controlled `ACCOUNT_DISABLED` error for inactive profiles.

- [ ] **Step 4: Add Next.js 16 proxy session refresh and protected layout**

Use `proxy.ts` rather than legacy `middleware.ts` for Next.js 16. Root `inventory-app/proxy.ts` delegates to `lib/supabase/proxy.ts` to refresh the auth session. Match all application routes except static assets.

In `app/(protected)/layout.tsx`, call `getCurrentAccess()` before rendering children. Do not rely on client-side hiding for authentication.

- [ ] **Step 5: Implement login and logout actions**

`app/(auth)/login/actions.ts` validates email/password with Zod, calls `supabase.auth.signInWithPassword`, writes `LOGIN_SUCCESS` via `app_audit_event`, and redirects to `/dashboard`.

On invalid credentials return:

```ts
{ ok: false, error: "Email or password is incorrect." }
```

Create a logout server action that calls `supabase.auth.signOut()` and redirects to `/login`.

- [ ] **Step 6: Implement Admin-only Manager invitation**

`inviteManager` must:

1. call `getCurrentAccess()` and require `role === "admin"`;
2. validate email, display name, location ID, and a list of allowed `PermissionKey`s;
3. use the service client `auth.admin.inviteUserByEmail(email)`;
4. insert a `user_profiles` row with `role='manager'` and the selected location;
5. insert enabled `manager_permissions` rows;
6. write `MANAGER_INVITED` audit history through a service-side insert including the authenticated Admin actor ID.

If profile/permission insertion fails after invitation, delete the newly invited auth user before returning an error so the system does not leave an orphaned login.

- [ ] **Step 7: Add a bootstrap script for the first Admin**

`scripts/bootstrap-admin.ts` accepts environment variables `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_NAME`, finds that existing Supabase Auth user using the service client, and upserts:

```ts
{ user_id: user.id, display_name: name, role: "admin", location_id: null, active: true }
```

It must refuse to create an Auth password itself. Create the first Auth user in the Supabase dashboard/local test setup, then run the script to assign the inventory Admin role.

- [ ] **Step 8: Run auth unit checks and build**

```powershell
npm run test:unit -- access-context.test.ts permissions.test.ts
npm run typecheck
npm run build
```

Expected: all pass; no service-role import is reachable from a client bundle.

- [ ] **Step 9: Commit authentication and user provisioning**

```bash
git add inventory-app
git commit -m "feat(inventory): add authentication and manager provisioning"
```

---

### Task 4: Build the Responsive Desktop/Mobile Shell and Location Scope

**Files:**
- Create: `inventory-app/lib/location/scope.ts`
- Create: `inventory-app/app/(protected)/actions.ts`
- Create: `inventory-app/components/shell/app-shell.tsx`
- Create: `inventory-app/components/shell/desktop-sidebar.tsx`
- Create: `inventory-app/components/shell/mobile-nav.tsx`
- Create: `inventory-app/components/shell/topbar.tsx`
- Create: `inventory-app/components/location/location-scope-select.tsx`
- Create: `inventory-app/app/(protected)/dashboard/page.tsx`
- Create: `inventory-app/tests/unit/location-scope.test.ts`
- Create: `inventory-app/tests/unit/shell-navigation.test.tsx`

**Interfaces:**
- Produces: `resolveLocationScope(access, requestedCode)`.
- Produces: Admin cookie `inventory_location_scope` with values `ALL|LON|REG`.
- Produces: `AppShell` used by every protected Phase 1 screen.

- [ ] **Step 1: Write failing scope tests**

```ts
import { expect, it } from "vitest";
import { resolveLocationScope } from "../../lib/location/scope";

it("forces a manager to their assigned branch", () => {
  expect(resolveLocationScope({ role: "manager", locationCode: "LON" }, "REG")).toEqual({ kind: "location", code: "LON" });
});

it("allows admin all locations or a branch", () => {
  expect(resolveLocationScope({ role: "admin", locationCode: null }, "ALL")).toEqual({ kind: "all" });
  expect(resolveLocationScope({ role: "admin", locationCode: null }, "REG")).toEqual({ kind: "location", code: "REG" });
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm run test:unit -- location-scope.test.ts
```

Expected: FAIL because scope resolver does not exist.

- [ ] **Step 3: Implement scope resolver and server action**

Use exact type:

```ts
export type LocationScope = { kind: "all" } | { kind: "location"; code: LocationCode };
```

`resolveLocationScope` ignores requested scope for Managers and always returns their assigned code. The Admin action `setLocationScope` accepts only `ALL`, `LON`, `REG`, confirms current user is Admin, sets an HTTP-only/same-site cookie, and calls `revalidatePath("/", "layout")`.

- [ ] **Step 4: Write shell navigation component test**

Render `AppShell` with Manager access and assert:

```ts
expect(screen.getByText("Dashboard")).toBeInTheDocument();
expect(screen.getByText("Inventory")).toBeInTheDocument();
expect(screen.getByText("Stock In")).toBeInTheDocument();
expect(screen.queryByText("All Locations")).not.toBeInTheDocument();
```

Render as Admin and assert the location selector exposes `All Locations`, `Lonsdale`, and `Regency Park`.

- [ ] **Step 5: Implement the shell**

Desktop sidebar Phase 1 links:

- Dashboard → `/dashboard`
- Inventory → `/inventory`
- Stock In → `/stock/in`
- Stock Out → `/stock/out`
- Adjust Stock → `/stock/adjust`
- Users → `/settings/users` (Admin only)

Mobile bottom nav:

- Home → `/dashboard`
- Stock → `/inventory`
- Stock In → `/stock/in`
- Stock Out → `/stock/out`
- More → opens a Sheet containing Adjust Stock and Admin Users when authorized.

Use the existing approved `public/brand/logo-real-horizontal.png` brand asset copied in Task 1. Keep layout business-like: fixed desktop sidebar at `lg`, mobile bottom navigation below `lg`, sticky top bar, minimum 44px touch targets, and no marketing-site animations.

- [ ] **Step 6: Run component and responsive smoke tests**

```powershell
npm run test:unit -- location-scope.test.ts shell-navigation.test.tsx
npm run typecheck
npm run build
```

Expected: Manager cannot render an Admin scope selector; desktop and mobile navigation compile.

- [ ] **Step 7: Commit the shell**

```bash
git add inventory-app/app inventory-app/components inventory-app/lib/location inventory-app/tests/unit
git commit -m "feat(inventory): add responsive app shell and location scope"
```

---

### Task 5: Create Product Catalogue, Normalised Tyre Data, and Hybrid Used-Tyre Records

**Files:**
- Create: `inventory-app/supabase/migrations/20260902091000_product_catalog.sql`
- Create: `inventory-app/lib/products/types.ts`
- Create: `inventory-app/lib/products/validation.ts`
- Create: `inventory-app/lib/products/repository.ts`
- Create: `inventory-app/app/(protected)/inventory/actions.ts`
- Create: `inventory-app/components/inventory/product-form.tsx`
- Create: `inventory-app/components/inventory/product-table.tsx`
- Create: `inventory-app/app/(protected)/inventory/page.tsx`
- Create: `inventory-app/app/(protected)/inventory/[productId]/page.tsx`
- Create: `inventory-app/tests/unit/product-validation.test.ts`
- Create: `inventory-app/tests/integration/product-rls.test.ts`

**Interfaces:**
- Produces tables: `product_categories`, `tyre_brands`, `tyre_patterns`, `tyre_sizes`, `products`, `used_tyre_units`, `inventory_settings`.
- Produces: `ProductInputSchema`, `UsedTyreUnitInputSchema`.
- Produces: `listProducts`, `getProduct`, `createProduct`, `archiveProduct`, `createUsedTyreUnit`.

- [ ] **Step 1: Write product validation tests first**

Cover these exact cases:

```ts
expect(ProductInputSchema.safeParse({
  name: "Michelin X Multi 295/80R22.5",
  category: "truck_tyre",
  sellingPriceInclGst: 685,
  tyre: { condition: "new", brand: "Michelin", pattern: "X Multi", size: "295/80R22.5", loadIndex: "152/148", speedRating: "M" }
}).success).toBe(true);

expect(ProductInputSchema.safeParse({ name: "Bad tyre", category: "truck_tyre", sellingPriceInclGst: -1 }).success).toBe(false);
expect(UsedTyreUnitInputSchema.safeParse({ treadDepthMm: -2, condition: "good" }).success).toBe(false);
```

- [ ] **Step 2: Run and verify validation test failure**

```powershell
npm run test:unit -- product-validation.test.ts
```

Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Create catalogue migration**

Create category enum/check values exactly:

- `truck_tyre`
- `rim_wheel`
- `tube`
- `valve`
- `wheel_nut_stud`
- `repair_material`
- `balancing_weight`
- `workshop_consumable`
- `other_part`

Tables must include:

```sql
create table public.product_categories (
  code text primary key,
  name text not null unique,
  sort_order integer not null
);

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
  unique (brand_id, normalized_name)
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
  updated_at timestamptz not null default now(),
  constraint tyre_fields_ck check (
    category_code <> 'truck_tyre' or
    (tyre_condition is not null and tyre_brand_id is not null and tyre_size_id is not null)
  )
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
  created_at timestamptz not null default now(),
  constraint used_unit_product_ck check (product_id is not null)
);

create table public.inventory_settings (
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  reorder_quantity integer not null default 0 check (reorder_quantity >= 0),
  primary key(product_id, location_id)
);
```

Seed `product_categories` with the nine approved categories.

RLS rules:

- authenticated active users can read active product catalogue;
- only Admin can insert/archive product master records in Phase 1;
- Manager can read `used_tyre_units` only for their location;
- Admin can read both locations;
- used-unit writes require Admin or `inventory.adjust` and must target the Manager's location;
- `inventory_settings` reads follow location isolation; writes are Admin-only in Phase 1.

- [ ] **Step 4: Implement Zod schemas and repository**

Normalize brand/pattern/size with:

```ts
export function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}
```

`createProduct` is Admin-only and in one server action:

1. validates input;
2. upserts normalized brand, pattern and size for truck tyres;
3. inserts product;
4. inserts zeroed `inventory_settings` rows for both LON and REG;
5. writes a `PRODUCT_CREATED` audit event.

`createUsedTyreUnit` requires the product to be `truck_tyre` + `used`, assigns an internal code in the format `UT-000001` from a database-backed sequence, and does not itself alter grouped stock quantity; Task 6 will link individual-unit availability to movement posting.

- [ ] **Step 5: Build catalogue pages**

`/inventory` supports server-side filters for category, tyre condition, brand, size, active status, and free-text product search. Admin sees `New Product`; Managers do not.

`/inventory/[productId]` displays master data plus used-unit records visible under current location scope. Do not expose the other branch's used-unit rows to Managers.

- [ ] **Step 6: Add RLS integration tests**

Prove:

- Lonsdale Manager and Regency Park Manager can both read global product master data;
- Lonsdale Manager cannot read a Regency Park `used_tyre_units` row;
- Manager cannot directly insert a product master row;
- Admin can insert a product and read used units from both locations.

- [ ] **Step 7: Run catalogue checks**

```powershell
npx supabase db reset
npm run test:unit -- product-validation.test.ts
npm run test:integration -- product-rls.test.ts
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 8: Commit product catalogue**

```bash
git add inventory-app
git commit -m "feat(inventory): add product and tyre catalogue"
```

---

### Task 6: Build the Atomic Inventory Ledger, Balance Table, WAC, and No-Negative-Stock RPCs

**Files:**
- Create: `inventory-app/supabase/migrations/20260902092000_inventory_ledger.sql`
- Create: `inventory-app/lib/inventory/types.ts`
- Create: `inventory-app/lib/inventory/repository.ts`
- Create: `inventory-app/tests/unit/wac-display.test.ts`
- Create: `inventory-app/tests/integration/inventory-rpc.test.ts`
- Create: `inventory-app/tests/integration/inventory-concurrency.test.ts`

**Interfaces:**
- Produces tables: `inventory_balances`, `inventory_movements`.
- Produces RPC: `post_inventory_movement(...)`.
- Produces RPC: `set_inventory_count(...)`.
- Produces read function: `getInventoryBalance(productId, locationId)`.
- Mutation result type:

```ts
export type InventoryMutationResult = {
  movementId: string;
  onHand: number;
  reserved: number;
  available: number;
  weightedAverageCost: number;
};
```

- [ ] **Step 1: Write integration tests for WAC and negative-stock behavior before migration implementation**

`tests/integration/inventory-rpc.test.ts` must exercise a product at Lonsdale:

1. `+10` Quick Stock-In at `$400` → on hand `10`, WAC `400`.
2. `+10` Quick Stock-In at `$500` → on hand `20`, WAC `450`.
3. `-2` Stock-Out → on hand `18`, WAC stays `450`.
4. Attempt `-19` → RPC error `INSUFFICIENT_STOCK`, on hand remains `18`.
5. Re-submit the exact same `request_id` from step 3 → return the original result and do not create a second movement.

- [ ] **Step 2: Run the integration test and verify it fails**

```powershell
npm run test:integration -- inventory-rpc.test.ts
```

Expected: FAIL because ledger tables/RPCs do not exist.

- [ ] **Step 3: Create ledger schema**

Migration core:

```sql
create table public.inventory_balances (
  product_id uuid not null references public.products(id),
  location_id uuid not null references public.locations(id),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  weighted_average_cost numeric(14,4) not null default 0 check (weighted_average_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key(product_id, location_id)
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

Enable RLS. `inventory_balances` and `inventory_movements` SELECT policies are Admin-all / Manager-assigned-location. Revoke direct INSERT/UPDATE/DELETE from authenticated; all mutation writes go through RPCs.

- [ ] **Step 4: Implement `post_inventory_movement` as the sole Phase 1 delta mutation primitive**

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
returns table(
  movement_id uuid,
  on_hand integer,
  reserved integer,
  available integer,
  weighted_average_cost numeric
)
```

Inside the function, in this order:

1. validate authenticated active profile;
2. Admin may target either location; Manager target must equal `app_user_location_id()`;
3. map movement permission: `quick_stock_in|used_unit_in` → `inventory.stock_in`; `stock_out|used_unit_out` → `inventory.stock_out`; `adjustment` → `inventory.adjust`;
4. if `request_id` already exists, return the existing movement's resulting current balance without creating another movement;
5. ensure a balance row exists, then `SELECT ... FOR UPDATE` it;
6. calculate `new_on_hand = old_on_hand + p_quantity_delta`; raise `INSUFFICIENT_STOCK` when below zero or below `reserved`;
7. for positive `quick_stock_in` require `p_inbound_unit_cost >= 0` and calculate WAC as `((old_on_hand * old_wac) + (qty * cost)) / new_on_hand`; zero existing stock uses inbound cost directly;
8. outbound movements leave WAC unchanged and store old WAC as `cost_snapshot`;
9. insert one movement;
10. update balance;
11. if `used_tyre_unit_id` is present, validate it belongs to the product/location and set status consistently: positive unit-in → `available`, negative unit-out → `sold`; individual unit movement quantity must be `+1` or `-1`;
12. write `INVENTORY_MOVEMENT_POSTED` to `audit_events` with before/after quantities, movement type, reason, and movement ID;
13. return the resulting balance.

All steps execute within the single RPC transaction.

- [ ] **Step 5: Implement absolute stock adjustment RPC**

`set_inventory_count(p_request_id, p_product_id, p_location_id, p_count, p_reason, p_notes)`:

- requires `inventory.adjust` or Admin;
- `p_reason` must be non-empty;
- locks current balance;
- rejects `p_count < reserved`;
- computes `delta = p_count - on_hand`;
- rejects zero delta with `NO_STOCK_CHANGE` so the audit stream contains only actual stock changes;
- preserves current WAC;
- inserts one `adjustment` movement and audit event atomically.

- [ ] **Step 6: Add concurrency test**

Seed on-hand `2`. Fire two authenticated `post_inventory_movement` calls concurrently: one requests `-2`, one requests `-1`, each with distinct request IDs.

Assert:

```ts
expect(results.filter(r => r.ok)).toHaveLength(1);
expect(results.filter(r => !r.ok)).toHaveLength(1);
expect(finalBalance.on_hand).toBeGreaterThanOrEqual(0);
expect(finalBalance.on_hand).toBe(0 /* if -2 won */ || 1 /* if -1 won */);
```

Implement the assertion without invalid JS by computing the successful delta and asserting `finalBalance.on_hand === 2 + successfulDelta`.

- [ ] **Step 7: Implement typed repository adapter**

`lib/inventory/repository.ts` exports:

```ts
export async function postInventoryMovement(client: SupabaseClient, input: InventoryMovementInput): Promise<InventoryMutationResult>;
export async function setInventoryCount(client: SupabaseClient, input: InventoryCountAdjustmentInput): Promise<InventoryMutationResult>;
export async function getInventoryBalance(client: SupabaseClient, productId: string, locationId: string): Promise<InventoryBalance>;
```

Map database errors:

- `INSUFFICIENT_STOCK` → `Cannot remove this quantity. Available stock has changed.`
- `ACCESS_DENIED` → `You do not have permission for this stock action.`
- `NO_STOCK_CHANGE` → `The counted quantity is already correct.`

Do not duplicate WAC arithmetic in TypeScript writes.

- [ ] **Step 8: Run database and concurrency verification**

```powershell
npx supabase db reset
npm run test:integration -- inventory-rpc.test.ts inventory-concurrency.test.ts
npm run typecheck
```

Expected: WAC is 450 after the two inbound receipts, outbound stock does not alter WAC, negative stock is blocked, duplicate request IDs do not double-post, and concurrent stock-outs cannot oversell.

- [ ] **Step 9: Commit the inventory engine**

```bash
git add inventory-app/supabase inventory-app/lib/inventory inventory-app/tests/integration inventory-app/tests/unit
git commit -m "feat(inventory): add atomic stock ledger and weighted cost"
```

---

### Task 7: Implement Stock In, Stock Out, and Manual Adjustment Workflows

**Files:**
- Create: `inventory-app/lib/inventory/validation.ts`
- Create: `inventory-app/app/(protected)/stock/actions.ts`
- Create: `inventory-app/components/stock/product-picker.tsx`
- Create: `inventory-app/components/stock/stock-in-form.tsx`
- Create: `inventory-app/components/stock/stock-out-form.tsx`
- Create: `inventory-app/components/stock/stock-adjustment-form.tsx`
- Create: `inventory-app/app/(protected)/stock/in/page.tsx`
- Create: `inventory-app/app/(protected)/stock/out/page.tsx`
- Create: `inventory-app/app/(protected)/stock/adjust/page.tsx`
- Create: `inventory-app/tests/unit/stock-validation.test.ts`
- Create: `inventory-app/tests/unit/stock-form.test.tsx`

**Interfaces:**
- Produces Zod schemas: `StockInSchema`, `StockOutSchema`, `StockAdjustmentSchema`.
- Produces server actions: `stockInAction`, `stockOutAction`, `adjustStockAction`.
- All actions return `ActionResult<InventoryMutationResult>`.

- [ ] **Step 1: Write failing stock validation tests**

Exact requirements:

```ts
expect(StockInSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), quantity: 12, unitCost: 445, supplierReference: "INV-84741" }).success).toBe(true);
expect(StockInSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), quantity: 0, unitCost: 445 }).success).toBe(false);
expect(StockOutSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), quantity: 2, reason: "damaged" }).success).toBe(true);
expect(StockAdjustmentSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), countedQuantity: 13, reason: "physical_count_correction" }).success).toBe(true);
expect(StockAdjustmentSchema.safeParse({ productId: crypto.randomUUID(), locationId: crypto.randomUUID(), countedQuantity: 13, reason: "" }).success).toBe(false);
```

Allowed Stock-Out reasons:

- `damaged`
- `write_off`
- `internal_use`
- `missing`
- `data_correction`
- `warranty_return`
- `supplier_return`
- `other`

- [ ] **Step 2: Run and verify validation failure**

```powershell
npm run test:unit -- stock-validation.test.ts
```

Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Implement validation and typed action result**

Use:

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
```

Generate `requestId = crypto.randomUUID()` inside the client form once per submission attempt and include it in FormData so a network retry of the same submission can reuse the same ID.

- [ ] **Step 4: Implement server actions with authoritative access checks**

Each action:

1. calls `getCurrentAccess()`;
2. checks exact permission with `hasPermission`;
3. resolves target branch: Manager input location is ignored/rejected unless it matches assigned location; Admin may target LON/REG;
4. validates product exists/active;
5. calls the appropriate RPC through the user-scoped Supabase client;
6. calls `revalidatePath("/inventory")`, `revalidatePath("/dashboard")`, and the affected product page;
7. returns the friendly RPC error mapping from Task 6.

Stock-In uses movement type `quick_stock_in` and requires unit cost. Stock-Out uses `stock_out`. Adjustment uses `set_inventory_count`.

- [ ] **Step 5: Write interaction tests before implementing forms**

With Testing Library, verify:

- Stock In quantity and unit cost inputs reject empty/zero values.
- Stock Out reason is mandatory.
- Adjustment requires a reason.
- submitting changes the primary button label to `Processing...` and disables it.
- Manager form displays assigned branch as read-only text; Admin form renders a branch selector.

- [ ] **Step 6: Build mobile-first forms**

Form layout requirements:

- searchable `ProductPicker` at top;
- show current On Hand / Reserved / Available after selection;
- quantity stepper uses buttons plus numeric input;
- inputs have minimum 44px touch height;
- no barcode/QR control exists anywhere;
- success state shows new quantity and, when permitted, new WAC;
- Stock-Out refuses a quantity greater than currently displayed Available before submit, while RPC still revalidates at commit time;
- adjustment UI labels target field `Counted Quantity`, not `Quantity +/-`.

- [ ] **Step 7: Run UI and build checks**

```powershell
npm run test:unit -- stock-validation.test.ts stock-form.test.tsx
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 8: Commit stock workflows**

```bash
git add inventory-app/app inventory-app/components/stock inventory-app/lib/inventory inventory-app/tests/unit
git commit -m "feat(inventory): add stock in out and adjustment flows"
```

---

### Task 8: Build Inventory Summary, Search, Low-Stock Rules, and Phase 1 Dashboard

**Files:**
- Create: `inventory-app/supabase/migrations/20260902093000_inventory_summary_views.sql`
- Create: `inventory-app/lib/inventory/queries.ts`
- Create: `inventory-app/lib/inventory/low-stock.ts`
- Modify: `inventory-app/app/(protected)/inventory/page.tsx`
- Modify: `inventory-app/app/(protected)/inventory/[productId]/page.tsx`
- Modify: `inventory-app/app/(protected)/dashboard/page.tsx`
- Create: `inventory-app/components/inventory/inventory-table.tsx`
- Create: `inventory-app/components/inventory/inventory-mobile-list.tsx`
- Create: `inventory-app/components/inventory/low-stock-card.tsx`
- Create: `inventory-app/components/inventory/reorder-settings-form.tsx`
- Create: `inventory-app/tests/unit/low-stock.test.ts`
- Create: `inventory-app/tests/integration/inventory-summary.test.ts`

**Interfaces:**
- Produces view: `inventory_product_summary` with `security_invoker = true`.
- Produces: `searchInventory(scope, filters)`.
- Produces: `getDashboardInventoryMetrics(scope)`.
- Produces: `isLowStock({available, minimumStock}): boolean`.

- [ ] **Step 1: Write low-stock unit test first**

```ts
import { expect, it } from "vitest";
import { isLowStock } from "../../lib/inventory/low-stock";

it("flags stock only when available is below the minimum", () => {
  expect(isLowStock({ available: 4, minimumStock: 6 })).toBe(true);
  expect(isLowStock({ available: 6, minimumStock: 6 })).toBe(false);
  expect(isLowStock({ available: 7, minimumStock: 6 })).toBe(false);
});
```

- [ ] **Step 2: Run and verify failure**

```powershell
npm run test:unit -- low-stock.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Create security-invoker summary view**

Migration:

```sql
create view public.inventory_product_summary
with (security_invoker = true)
as
select
  p.id as product_id,
  p.name,
  p.category_code,
  p.part_reference,
  p.selling_price_incl_gst,
  p.tyre_condition,
  b.location_id,
  l.code as location_code,
  l.name as location_name,
  b.on_hand,
  b.reserved,
  (b.on_hand - b.reserved) as available,
  b.weighted_average_cost,
  coalesce(s.minimum_stock, 0) as minimum_stock,
  coalesce(s.reorder_quantity, 0) as reorder_quantity,
  ((b.on_hand - b.reserved) < coalesce(s.minimum_stock, 0)) as low_stock
from public.products p
join public.inventory_balances b on b.product_id = p.id
join public.locations l on l.id = b.location_id
left join public.inventory_settings s on s.product_id = p.id and s.location_id = b.location_id
where p.active;
```

Grant SELECT to authenticated. Because the view is `security_invoker`, underlying `inventory_balances` RLS continues to isolate Managers.

Add indexes on `products(name)`, `products(part_reference)`, tyre lookup normalized fields, and `inventory_movements(location_id, created_at desc)`.

- [ ] **Step 4: Ensure every product has a balance row at both locations**

Add an Admin-only trigger/function executed after product creation that inserts zero balances for LON and REG using `ON CONFLICT DO NOTHING`. This lets Admin `All Locations` inventory display zero-stock products without manufacturing movements. Initial zero balance is not a stock change and therefore does not create a movement.

- [ ] **Step 5: Implement search and dashboard queries**

`searchInventory` supports:

- free-text against product name, part reference, brand display name, pattern display name, tyre size display value;
- category;
- New/Used;
- low-stock-only;
- Admin scope `ALL|LON|REG`;
- Manager fixed location.

Return WAC only when `hasPermission(access, "inventory.view_cost")`; Admin always receives it.

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

`inventoryValue` is `null` for a Manager lacking `reports.view_inventory_value`.

- [ ] **Step 6: Build responsive inventory screen**

Desktop columns:

- Product
- Condition/category
- Lonsdale qty (Admin All only)
- Regency Park qty (Admin All only)
- branch Available qty (branch scope/Manager)
- Sell Price
- Low Stock status
- WAC only when authorized

Mobile cards show product, size/brand where relevant, available quantity, sell price, and Low Stock badge. Tapping opens product details with `Stock In`, `Stock Out`, and `History` actions based on permissions.

- [ ] **Step 7: Implement reorder settings**

Admin-only form on product detail allows minimum stock and reorder quantity per branch. Persist directly through a server action after Admin role check. Manager can view their branch thresholds but cannot edit them in Phase 1.

- [ ] **Step 8: Add integration tests for location-aware summaries**

Seed different balances:

- LON product A available 4, minimum 6 → Low Stock.
- REG product A available 15, minimum 6 → Healthy.

Assert Lonsdale Manager query returns only LON row and `low_stock=true`; Regency Park Manager returns only REG row and `low_stock=false`; Admin All returns both.

- [ ] **Step 9: Run summary and dashboard checks**

```powershell
npx supabase db reset
npm run test:unit -- low-stock.test.ts
npm run test:integration -- inventory-summary.test.ts
npm run typecheck
npm run build
```

Expected: location isolation and low-stock status are correct.

- [ ] **Step 10: Commit inventory browse and low-stock dashboard**

```bash
git add inventory-app
git commit -m "feat(inventory): add stock search low-stock and dashboard"
```

---

### Task 9: Add Phase 1 Security, End-to-End, CI, and Deployment Verification

**Files:**
- Create: `inventory-app/tests/e2e/global.setup.ts`
- Create: `inventory-app/tests/e2e/auth.spec.ts`
- Create: `inventory-app/tests/e2e/inventory-manager.spec.ts`
- Create: `inventory-app/tests/e2e/inventory-admin.spec.ts`
- Create: `inventory-app/tests/e2e/mobile-stock.spec.ts`
- Create: `.github/workflows/inventory.yml`
- Create: `inventory-app/README.md`
- Create: `docs/inventory-phase-1-deployment.md`

**Interfaces:**
- Produces repeatable local/staging setup instructions.
- Produces CI gate for lint, typecheck, unit tests, build, and opt-in integration/E2E tests when secrets are configured.
- Produces verified Phase 1 acceptance workflows.

- [ ] **Step 1: Create deterministic E2E test users in global setup**

`global.setup.ts` uses only the test/staging service role to create:

- `inventory-admin@test.local` → Admin.
- `inventory-lon@test.local` → Manager at Lonsdale with `inventory.view`, `inventory.stock_in`, `inventory.stock_out`, `inventory.adjust`, `inventory.view_cost`, `reports.view_inventory_value`.
- `inventory-reg@test.local` → Manager at Regency Park with `inventory.view`, `inventory.stock_in`, `inventory.stock_out`, `inventory.adjust` and no cost/value permissions.

Use fixed passwords only in test environment variables; delete/recreate these users for deterministic state.

- [ ] **Step 2: Write auth/location E2E tests**

`auth.spec.ts`:

- unauthenticated `/dashboard` redirects to `/login`;
- valid Admin login reaches dashboard;
- invalid password displays `Email or password is incorrect.`.

`inventory-manager.spec.ts`:

- Lonsdale Manager header says `Lonsdale`;
- no `All Locations` selector exists;
- Manager cannot navigate to `/settings/users` successfully;
- opening an attempted Regency Park-only inventory URL does not reveal REG data.

- [ ] **Step 3: Write full stock flow E2E test**

As Lonsdale Manager:

1. search a seeded product;
2. Quick Stock-In 10 at `$400`;
3. Quick Stock-In 10 at `$500`;
4. verify on hand `20` and WAC `$450.00` when permission allows;
5. Stock-Out 2 damaged;
6. verify on hand `18`;
7. attempt Stock-Out 19 and verify friendly insufficient-stock error;
8. adjust counted stock to 17 with reason `Physical count correction`;
9. verify history shows each movement and the mandatory adjustment reason.

- [ ] **Step 4: Write Admin and cost-visibility E2E tests**

Admin test verifies:

- All Locations selector exists;
- inventory shows LON and REG quantities separately;
- Admin can edit low-stock thresholds for either branch;
- Admin Users page loads.

Regency Park Manager test verifies WAC and inventory value are not rendered because those permissions are disabled.

- [ ] **Step 5: Write mobile E2E test**

At viewport `390x844`:

- bottom navigation is visible;
- desktop sidebar is hidden;
- Stock In form has no horizontal overflow;
- submit button is visible without hover;
- no barcode/QR scanner control exists;
- successful stock-in returns to a clear success state with updated quantity.

- [ ] **Step 6: Create GitHub Actions workflow**

`.github/workflows/inventory.yml` uses Node 22 and `working-directory: inventory-app` for:

```yaml
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm run test:unit
- run: npm run build
```

Add a separate integration/E2E job guarded by the presence of repository test secrets, never production Supabase credentials.

- [ ] **Step 7: Document local setup and Vercel deployment**

`inventory-app/README.md` must include exact local commands:

```powershell
Set-Location -LiteralPath .\inventory-app
Copy-Item .env.example .env.local
npm install
npx supabase start
npx supabase db reset
npm run dev
```

`docs/inventory-phase-1-deployment.md` must state:

- Create a separate Vercel project with **Root Directory = `inventory-app`**.
- Use a separate inventory Supabase project, not the public website's production database.
- Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` in the inventory Vercel project.
- Apply `inventory-app/supabase/migrations` in filename order.
- Bootstrap the first Admin only after their Auth user exists.
- Do not place the service-role key in `NEXT_PUBLIC_*` variables.
- Run the complete verification commands before production promotion.

- [ ] **Step 8: Run the complete Phase 1 verification gate**

```powershell
Set-Location -LiteralPath .\inventory-app
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

Expected: every command exits `0` against the disposable/local test Supabase project.

- [ ] **Step 9: Manually verify the two key responsive workflows**

Desktop at 1440px:

- Admin login → All Locations dashboard → Inventory → branch quantities → product detail → low-stock thresholds.

Mobile at 390px:

- Lonsdale Manager login → Stock In → Stock Out → Adjustment → Inventory search.

Acceptance criteria: no horizontal overflow; no inaccessible hover-only actions; branch name always visible; Manager cannot change branch; no fake sales/invoice cards are populated before later phases.

- [ ] **Step 10: Commit Phase 1 verification and deployment docs**

```bash
git add inventory-app .github/workflows/inventory.yml docs/inventory-phase-1-deployment.md
git commit -m "test(inventory): verify phase 1 workflows"
```

---

## Phase 1 Completion Gate

Phase 1 is complete only when all statements below are true:

- The public 24/7 marketing application still builds independently from repository root.
- `inventory-app/` builds independently as the internal application.
- Email/password authentication works.
- Admin sees Lonsdale, Regency Park, and All Locations.
- Each Manager is fixed to exactly one assigned branch.
- RLS/integration tests prove branch data cannot be bypassed with direct queries.
- Admin can invite a Manager and assign Phase 1 permissions.
- Product catalogue supports all approved workshop categories.
- Truck tyres support New/Used fields and normalised brand/pattern/size values.
- Used tyres support grouped inventory and individually tracked used units.
- No barcode or QR features exist.
- Every non-zero stock change is represented by an inventory movement.
- Quick Stock-In updates location WAC correctly.
- Stock-Out does not alter WAC.
- Negative stock is blocked in concurrent database writes.
- Duplicate mutation request IDs cannot double-post stock.
- Manual adjustments require a reason and create audit history.
- LON and REG have independent balances, WAC, minimum stock, and reorder quantities.
- Global selling price remains one product value across locations.
- Low-stock state is calculated from `Available < Minimum` per location.
- Managers without cost/value permissions cannot retrieve/render those values.
- Desktop and mobile primary stock workflows are usable and tested.
- Lint, typecheck, unit tests, integration tests, build, and E2E tests pass.
- Vercel deployment uses `inventory-app` as a separate Root Directory and a separate inventory Supabase project.

## Deferred to Later Plans

The following approved specification areas intentionally remain out of Phase 1 and must be implemented in subsequent plans, not opportunistically added here:

1. Suppliers, Purchase Orders, approvals, goods receipts, suggested POs.
2. Lonsdale ↔ Regency Park transfer request/approval/dispatch/receive flow.
3. Full stocktake workflow.
4. Customers, business/fleet accounts, vehicles.
5. Quotes, jobs, reservations, POS.
6. Invoices, payment terms, receivables, refunds, Stripe payments.
7. Resend invoice/payment/reminder emails.
8. Sales/GST/profit/customer/supplier/transfer reports and exports.
9. Broader notification centre and later-stage PWA production polish.
