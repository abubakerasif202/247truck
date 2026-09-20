<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project status: maintenance mode

The 24/7 Truck Tyre Services inventory application is feature-complete for the current paid scope.

Do not add or expand features unless the user explicitly authorizes new paid work.

Before changing code, classify the request as exactly one of:

- BUG
- SECURITY
- DATA INTEGRITY
- MAINTENANCE
- NEW FEATURE

Allowed without new paid-scope approval:

- production bug fixes
- security fixes
- data-integrity fixes
- broken workflow fixes
- critical dependency/security updates
- regression fixes
- performance fixes tied to a demonstrated production problem

Not allowed without explicit authorization:

- new modules
- new AI tools
- new dashboards
- new reports
- new automations
- new integrations
- redesigns
- speculative enhancements
- feature creep

If the request is NEW FEATURE, stop and report it instead of implementing it.

For allowed maintenance work, stay lean: diagnose the root cause, make the smallest safe fix, verify it, and stop. Do not broaden a fix into unrelated refactors or feature work.

Preserve all existing business logic, permissions/RLS, tenant and location isolation, invoice/payment calculations, inventory ledger rules, URLs, and production behavior unless the task specifically requires a verified correction.
