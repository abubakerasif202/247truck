# 24/7 Truck Tyre Services

Production website for 24/7 Truck Tyre Services in Regency Park, South Australia. Built with React, Next.js-compatible routing through vinext, and OpenAI Sites hosting.

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
npm run build
node --test tests\rendered-html.test.mjs
```

## Routes

- `/` — homepage
- `/services` — all commercial tyre services
- `/24-7-truck-tyre-assistance` — emergency roadside assistance
- `/truck-tyres` — tyre supply
- `/truck-tyre-fitting` — commercial fitting
- `/fleet-tyre-services` — fleet support
- `/about` — business overview
- `/gallery` — illustrative work gallery
- `/contact` — assistance form, phone and location

The contact form opens a pre-filled text message to the published service number. It does not retain customer information.
