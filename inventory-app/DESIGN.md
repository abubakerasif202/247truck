# 24/7 Inventory Operations Design System

## North star

Premium industrial operations software built specifically for 24/7 Truck Tyre Services. The interface should evoke a workshop control room: direct, durable, dense enough for warehouse work, and unmistakably tied to the public website without becoming a marketing page.

Anti-references: generic shadcn admin starters, pastel SaaS dashboards, banking interfaces, gaming/neon control panels, and rainbow KPI cards.

## Canonical visual source

The public 24/7 Truck Tyre Services website is the brand authority. Runtime tokens in `app/globals.css` are the implementation source of truth; shared UI and shell components consume their Tailwind theme mappings.

## Palette

- Shell: black `#0b0c0e`, near-black `#15171a`, charcoal `#202329`, graphite `#292d33`.
- Brand: red `#e30613`, crimson `#c8101e`, deep red `#a90d19`, red-on-dark `#ff4655`.
- Work surfaces: off-white `#f5f5f3`, white cards, steel-grey borders.
- Operations: success `#18794e`, warning `#a45d00`, information `#2563a8`, receiving `#13735b`, inventory `#42677d`, used tyre `#8a5a19`.
- Colour communicates domain or state through small accents, badges, icons, and soft surfaces. Text labels remain mandatory.

## Typography

- Oswald: page titles, operational eyebrows, shell identity, and large KPI numerals.
- Inter: forms, tables, buttons, labels, and body text.
- Dense tables remain sentence case and use tabular numeric alignment.

## Shape, depth, and motion

- Compact 8–12px radii, quiet steel borders, and restrained shadows.
- Red is concentrated in primary actions, active navigation, focus, and purchasing identity.
- A subtle road/tread stripe is reserved for login and page headers.
- Transitions are brief and functional; reduced-motion preferences remove them.

## Domain language

- Purchasing: crimson.
- Receiving and Stock In: green/teal.
- Inventory: blue-steel.
- Stock Out and errors: deep red.
- Low stock and partially received: amber.
- Used tyres: bronze.
- Lonsdale: blue-steel chip; Regency Park: graphite/red chip. Location colour is context, never authorization.

## Accessibility

Target WCAG 2.2 AA. Preserve visible focus, native semantics, accessible names, readable status labels, safe-area spacing, and non-colour status cues. Dense operational information must remain usable at mobile widths without changing workflow or permissions.
