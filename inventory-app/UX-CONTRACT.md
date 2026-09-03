# Inventory Operations UX Contract

This branding pass does not change application workflows, authorization, validation, navigation architecture, database behavior, or server actions.

## Canonical owners

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | Native select for compact operational filters | UX-CONTRACT.md | Native | Keyboard and E2E |
| Form | Shared fields plus existing server-action forms | components/ui and route actions | Create and edit | Unit and E2E |
| Scrollbar | Global application stylesheet | DESIGN.md | Global baseline | Browser QA |
| CRUD | Existing route and server-action workflows | Domain tests | Existing workflows only | Full-flow E2E |

- Navigation shell: `components/shell/*`; desktop sidebar and four-slot mobile bar retain the existing route and permission map in `components/shell/nav.ts`.
- Page identity: `components/ui/page-header.tsx`.
- Status presentation: `components/ui/status-badge.tsx`; every colour has visible text.
- Buttons, forms, cards, tables, overlays, and controls: `components/ui/*`.
- Runtime theme and global scrollbar: `app/globals.css`.
- Forms continue using their existing server actions and `noValidate` behavior.
- Tables retain existing desktop/mobile adaptations and data density.

## Behavioral invariants

- Permissions and branch scope remain server-enforced.
- Cost fields remain visible only to users with cost permission.
- Purchasing lifecycle controls retain their current labels and transitions.
- Success and error feedback retains its current live-region semantics.
- The mobile bar keeps Dashboard, Inventory, Stock In, and Stock Out; Purchasing stays under More.
- No visual token or location colour is a security boundary.
