# 24/7 Truck Tyre Services — Inventory

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

## Inventory ledger and opening financial states

Inventory quantities remain ledger-controlled and balances must never be edited
directly. Ordinary Quick Stock-In and purchase-order receiving continue to
require a known non-negative unit cost.

The confirmed initial opening balance is the explicit exception: the dedicated
Admin-only `opening_stock` path can post quantity while opening cost remains
unknown. Unknown financial values are stored as `NULL`, not `$0`.

Key opening-stock migrations add:

- nullable product Selling Price and nullable positive-stock WAC;
- dedicated audited `post_opening_stock` posting;
- immutable delayed opening-cost assignment and chronological WAC rebuild;
- known inventory value separated from `Unvalued stock`;
- fixed-source import evidence and idempotent per-row import processing.

## Opening stock dataset

The confirmed opening tyre source is:

`data/opening-stock-2026-09-04.csv`

It contains exactly **53 product lines / 725 tyres**. Every source row is:

- `New`
- `Truck Tyre`
- `Regency Park` (`REG`)
- Cost Price pending
- Selling Price pending

The source is loaded from the server-side repository path, SHA-256 fingerprinted,
strictly parsed, and rejected unless it still reconciles to exactly 53 lines and
725 total tyres. Browser-supplied product/quantity arrays are not authoritative.

### Admin opening-stock workflow

`Inventory → Opening Stock Import → Preview → Make 725 tyres live`

The preview identifies each source row as Create, Match, or Ambiguous. Ambiguous
product identities block Make Live. A successful first run posts all 725 units to
Regency Park through the dedicated opening-stock ledger path. Repeating the same
dataset is idempotent and must not add the quantities again.

After import:

- Selling Price stays `NULL` and displays `Price Pending` / `—` until assigned.
- Opening cost/WAC stays `NULL` and displays `Cost Pending` to authorized users.
- Numeric zero remains a real `$0.00`, distinct from pending.
- Admin may later assign the confirmed opening cost without editing the original
  opening movement; current WAC is reconstructed from movement history.
- Dashboard valuation reports `Known inventory value` separately from
  `Unvalued stock`.

See `data/README.md` for the import invariants and safety model.

See `../docs/inventory-phase-1-deployment.md` for production deployment.
