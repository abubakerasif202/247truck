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
- `/fleet-roadside-assistance` — fleet roadside assistance registration
- `/franchise` — franchise opportunity and enquiry
- `/about` — business overview
- `/gallery` — illustrative work gallery
- `/contact` — assistance form, phone and location

The urgent assistance form opens a pre-filled WhatsApp message to the published service number. Franchise and fleet forms post to the same-origin server endpoint and require server-only Resend configuration.

## Enquiry delivery

Copy `.env.example` to `.env.local` and provide real server-only values. Never expose these variables with a `NEXT_PUBLIC_` prefix.

- `RESEND_API_KEY` — Resend API key
- `ENQUIRY_TO_EMAIL` — recipient for franchise and fleet submissions
- `ENQUIRY_FROM_EMAIL` — optional verified sender; required for dependable production delivery

The endpoint validates and length-limits fields, requires consent, checks a honeypot and minimum completion time, enforces same-origin requests, and applies a best-effort per-instance rate limit. Production WAF rate limiting is still recommended.
