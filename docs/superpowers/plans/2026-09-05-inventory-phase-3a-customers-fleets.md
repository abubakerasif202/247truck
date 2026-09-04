# Inventory Phase 3A — Customers, Fleets and Vehicles

## Access decision

Customer, contact and vehicle records are business-wide master data. A customer may attend Lonsdale or Regency Park, so Phase 3A does not assign or duplicate customers by branch. Admin has all customer permissions. Managers may use only explicitly granted customer permissions. Future quotes, jobs, invoices and payments must carry their own `location_id` and enforce branch-scoped operational and financial history independently of the shared customer identity.

Direct authenticated access to customer-domain tables is denied. Permission-gated, database-authoritative RPCs return only customer/contact/vehicle master data and never inventory costs, valuation or unrelated audit details.

## Data model

- `customers`: immutable atomic `CUS-######` number, individual/business identity and billing fields, normalized search helpers, archive flag, optimistic version.
- `customer_contacts`: multiple fleet contacts with one active primary contact enforced by a partial unique index.
- `customer_vehicles`: stable truck/trailer/other records with preserved and normalized registration/fleet search values.
- `customer_rpc_requests`: request UUID, action, payload hash and stored result for create idempotency and key-reuse rejection.
- `customer_number_sequence`: one locked singleton counter because numbering is global, not location-specific.

Foreign keys use restrictive customer deletion semantics. No public hard-delete operation is provided; archive/reactivate RPCs preserve identities for future operational references.

## Delivery sequence

1. Add failing integration tests for validation, permissions, numbering/concurrency, duplicate warnings, search, contacts, vehicles, archive semantics, audit immutability and direct-table denial.
2. Add one additive imperative migration implementing tables, indexes, constraints, RLS, permissions and secure RPCs.
3. Add typed queries, Zod-backed Server Actions and responsive customer list/create/detail/edit/contact/vehicle UI.
4. Add unit tests for validation/navigation/components and Playwright desktop/mobile/Admin/Manager workflows.
5. Reset only localhost Supabase and run lint, typecheck, unit, full integration, full E2E, build, DB lint and manual Critical/High review.
6. Push, PR, merge, production preflight, apply only the customer migration, deploy, and postflight-reconcile opening inventory without creating production customer data.
