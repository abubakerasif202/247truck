# 24/7 Truck Tyre Services

Production website for 24/7 Truck Tyre Services in Regency Park, South Australia. Built with React and Next.js for Vercel hosting.

## Local development

Requires Node.js 22.13 or newer.

```powershell
Set-Location -LiteralPath "C:\Users\abuba\247truck"
npm install
npm run dev
```

## Quality checks

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

## Routes

- `/` — homepage
- `/services` — all commercial tyre services
- `/24-7-truck-tyre-assistance` — emergency roadside assistance
- `/truck-tyres` — tyre supply
- `/truck-tyre-fitting` — commercial fitting
- `/fleet-tyre-services` — fleet support
- `/fleet-roadside-assistance` — National Roadside Assistance Program registration
- `/book-wheel-alignment` — timed Truck Wheel Alignment workshop booking
- `/franchise` — franchise opportunity and enquiry
- `/about` — business overview
- `/gallery` — illustrative work gallery
- `/contact` — assistance form, phone and location

The urgent assistance form opens a pre-filled WhatsApp message to the published service number. Franchise and fleet forms post to the same-origin server endpoint and require server-only Resend configuration.

## Enquiry delivery

Copy `.env.example` to `.env.local` and provide real server-only values. Never expose these variables with a `NEXT_PUBLIC_` prefix.

- `RESEND_API_KEY` — Resend API key
- `ENQUIRY_TO_EMAIL` — recipient for franchise and fleet submissions
- `ENQUIRY_FROM_EMAIL` — sender identity on a domain verified in Resend

In Resend, verify `247trucktyreservices.com.au` (or the approved sending subdomain) and set `ENQUIRY_FROM_EMAIL` to an address on that verified domain. Add `RESEND_API_KEY`, `ENQUIRY_TO_EMAIL` and `ENQUIRY_FROM_EMAIL` as server-only deployment variables; none should use a `NEXT_PUBLIC_` prefix. The browser form posts JSON to `/api/enquiries`, and the route sends the validated submission to the configured recipient with the submitter's email as `reply_to`. The route intentionally has no default sender or recipient, preventing accidental delivery through an unrelated domain.

The endpoint validates and length-limits fields, requires consent, checks a honeypot and minimum completion time, enforces same-origin requests, and applies a best-effort per-instance rate limit. Production WAF rate limiting is still recommended.

## Booking and membership storage

Wheel-alignment bookings and roadside membership records use Supabase Postgres through server-only REST requests. Apply migrations in filename order; do not create the tables manually:

```powershell
Set-Location -LiteralPath "C:\Users\abuba\247truck"
npx supabase link --project-ref "YOUR_PROJECT_REF"
npx supabase db push
```

Required deployment variables are documented in `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` must remain server-only. The booking migration enforces the five official start times and a partial unique index for one confirmed booking per date/time. The membership migration separates submitted applications from activated memberships, enables RLS, and revokes browser-role table access.

Membership applications do not activate membership. After review, authorised operations can activate an application through the server-only endpoint below. The database RPC atomically approves the application and creates a one-year membership; the customer then receives a private card link. Card and cancellation tokens stay in URL fragments, are sent to APIs only in request bodies, and the private pages are marked `noindex` with a no-referrer policy.

```powershell
$headers = @{ Authorization = "Bearer $env:MEMBERSHIP_ACTIVATION_SECRET" }
$body = @{ applicationId = "APPROVED_APPLICATION_UUID" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://www.247trucktyreservices.com.au/api/memberships/activate" -Headers $headers -ContentType "application/json" -Body $body
```

Keep `MEMBERSHIP_ACTIVATION_SECRET` server-only and at least 32 random characters. This operation is intentionally not available in the public UI.

To prove database concurrency, point the opt-in integration test only at a disposable Supabase project:

```powershell
$env:SUPABASE_TEST_URL = "https://YOUR_TEST_PROJECT.supabase.co"
$env:SUPABASE_TEST_SERVICE_ROLE_KEY = "YOUR_TEST_SERVICE_ROLE_KEY"
npm test
```

Never run the concurrency test against production.
