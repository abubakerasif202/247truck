# 24/7 Truck Tyre Services — Inventory (Phase 1)

Standalone internal inventory application. It is **not** part of the public
marketing site at the repository root — separate Next.js app, separate Vercel
project, separate Supabase project.

## Stack

Next.js 16 · React 19 · TypeScript 5 · Tailwind 4 · shadcn/ui · Supabase
(Postgres + Auth) · Vitest · Playwright.

## Local development

```powershell
Set-Location -LiteralPath .\inventory-app
Copy-Item .env.example .env.local   # fill in the values below
npm install
npx supabase start                  # requires Docker Desktop
npx supabase db reset               # applies migrations + seed
npm run dev                         # http://localhost:3100
```

`.env.local` for local work (the values printed by `npx supabase status`):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service_role key>
NEXT_PUBLIC_INVENTORY_APP_URL=http://localhost:3100

# Integration + E2E only — must point at the LOCAL/disposable stack.
SUPABASE_TEST_URL=http://127.0.0.1:54331
SUPABASE_TEST_ANON_KEY=<local anon key>
SUPABASE_TEST_SERVICE_ROLE_KEY=<local service_role key>
SUPABASE_TEST_ALLOW_DESTRUCTIVE=true
```

### First Admin

1. Create the Auth user (Supabase Studio, or `supabase` CLI).
2. Promote it:

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = "you@example.com"
$env:BOOTSTRAP_ADMIN_NAME  = "Your Name"
npx tsx scripts/bootstrap-admin.ts
```

The script never creates or prints a password. Managers are then invited from
**Settings → Users**.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on port 3100 |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run test:unit` | Vitest unit tests (no DB) |
| `npm run test:integration` | Vitest DB tests — **run `npx supabase db reset` first** |
| `npm run test:e2e` | Playwright (starts `npm run dev`, needs the local stack + `db reset`) |

The integration and E2E suites **refuse to run** unless `SUPABASE_TEST_*` is set
and `SUPABASE_TEST_ALLOW_DESTRUCTIVE=true`. They create and delete Auth users and
write to the ledger, so only ever point them at a local/disposable project.

## Migrations

`supabase/migrations/` is applied in filename order:

1. `…_identity_access.sql` — locations, roles, permissions, audit, RLS helpers.
2. `…_product_catalog.sql` — categories, tyre lookups, products, used-tyre units.
3. `…_inventory_ledger.sql` — balances, append-only movements, WAC, no-negative
   stock, `post_inventory_movement` / `set_inventory_count` /
   `create_used_tyre_unit_with_stock`.
4. `…_inventory_summary.sql` — `inventory_product_summary` view,
   `set_reorder_settings`, `inventory_value_for_scope`.

## Opening stock dataset

The client-supplied opening tyre list is now stored at:

`data/opening-stock-2026-09-04.csv`

It contains **53 product lines / 725 tyres**. The supplied source includes only
Brand, Pattern, Size and Quantity. Location, New/Used condition and inbound unit
cost remain intentionally blank and must be confirmed before stock can be
posted to the live ledger. See `data/README.md` for the safe import rules.

See `../docs/inventory-phase-1-deployment.md` for production deployment.
