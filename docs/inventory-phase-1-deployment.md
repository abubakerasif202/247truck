# Inventory App — Phase 1 Deployment

The inventory application is deployed **separately** from the public 24/7
marketing website. Do not add its routes to the public app, and do not point it
at the public website's Supabase project.

## 1. Supabase project

- Create a **new, dedicated** Supabase project for inventory (e.g.
  `247-truck-inventory-prod`). It must not be:
  - the public 24/7 website production database,
  - the Gala-rentals project,
  - any existing shared project.
- Apply the migrations in `inventory-app/supabase/migrations/` **in filename
  order** using the Supabase CLI:

  ```bash
  cd inventory-app
  supabase link --project-ref <inventory-project-ref>
  supabase db push
  ```

- Auth settings: email/password enabled, **sign-up disabled**
  (`enable_signup = false`), email confirmations as your policy requires. Set the
  Site URL and redirect URLs to the deployed inventory domain (used by the
  Manager invitation and password-reset links, which land on `/auth/callback`).

## 2. Vercel project

- Create a **separate Vercel project** from the same repository.
- **Root Directory:** `inventory-app`.
- Framework preset: Next.js. Build command / output are the Next.js defaults.
- Environment variables:

  | Variable | Scope | Notes |
  | --- | --- | --- |
  | `NEXT_PUBLIC_SUPABASE_URL` | all | inventory project URL |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | inventory anon/publishable key |
  | `SUPABASE_SERVICE_ROLE_KEY` | server only | **never** prefix with `NEXT_PUBLIC_`; used only for Admin Manager provisioning |
  | `NEXT_PUBLIC_INVENTORY_APP_URL` | all | the deployed inventory URL |

  Do **not** set the `SUPABASE_TEST_*` variables in production.

## 3. First Admin

1. Create the first Admin Auth user in Supabase Studio (or via the CLI).
2. Run the bootstrap script against the production project (service-role key in
   the environment, never committed):

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_NAME="Admin" \
     npx tsx scripts/bootstrap-admin.ts
   ```

3. Sign in, then invite Managers from **Settings → Users**, assigning each to
   exactly one location (Lonsdale `LON` / Regency Park `REG`) with the Phase 1
   operational permissions they need.

## 4. Locations

`LON` (Lonsdale) and `REG` (Regency Park) are seeded by the identity migration.
No additional locations in Phase 1.

## 5. What is NOT in Phase 1

Purchase orders, transfers, full stocktake, customers, fleet accounts, jobs,
quotes, POS, invoices, payments, Stripe, Resend reminders, and accounting
reports are later phases and are not deployed here.

## 6. Backups & environments

- Enable automated Postgres backups on the inventory Supabase project.
- Keep a separate staging project; run the destructive integration/E2E suites
  only against local or staging, never production.
- Migrations are versioned in git; deploy history is Vercel's.
