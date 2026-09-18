# Finance deep-review coverage ledger

Review date: 2026-09-18. Scope is first-party invoice, quote, finance, document, email, and manual-sales lookup code. No production database, deployment, provider configuration, or real email was used.

## Confirmed fixes

- The manual invoice form requires `invoices.view` and `invoices.create`, but its customer and vehicle lookup routes accepted only quote, job, or POS permissions. Both routes now accept the same invoice capability pair while retaining their existing alternatives. `tests/unit/sales-route-invoice-auth.test.ts` covers the authorised flow and rejects invoice-view-only access.
- React-PDF inserted render-time metadata into invoice and quote attachments, changing durable retry payload fingerprints. Both documents now derive creation and modification metadata from their stored document date. Quote details provide `created_at` as an ISO timestamp, so metadata normalization accepts the leading calendar date and safely falls back for invalid input rather than concatenating a second time component.

## Reviewed coverage

- `lib/finance/{dates,errors,invoice-schemas,money,payment-policy,permissions,queries,refunds,types,validation}.ts`: local validation, decimal calculations, refund projection, permission hints, and RPC argument bounds.
- `lib/documents/{invoice-pdf,quote-pdf,render-invoice-pdf,render-quote-pdf,invoice-types,quote-types,invoice-fixture-10602}.ts(x)`: immutable document data construction, safe logo resolution, PDF rendering, date/metadata stability, and the Invoice 10602 regression fixture.
- `lib/email/{invoice-email,quote-email,send-status,quote-send-status}.ts`: payload construction and hashing, persisted attachment restoration, provider outcome classification, and read-only status flow.
- `app/(protected)/invoices/actions.ts`, `app/(protected)/quotes/actions.ts`, invoice/quote PDF routes, invoice/quote pages, receivables page, and `app/api/sales/{customers,vehicles,products}.ts`: server-side capability checks, action/RPC flow, rendering boundaries, idempotency/retry modes, and lookup callers.
- Unit and integration finance/document/email tests plus relevant migrations: `20260912133000_invoice_email_retry_safety.sql` and `20260914143000_quote_email_delivery.sql`.

## Focused validation

- `npx vitest run tests/unit/quote-pdf.test.tsx --reporter=verbose --testTimeout=60000`: 2 passed.
- `npx vitest run tests/unit/invoice-pdf.test.tsx --reporter=verbose --testTimeout=60000`: 3 passed. The byte-equality retry test spans two renders and passed after 12.7 seconds, demonstrating that attachment bytes no longer depend on render-time metadata.
- `npx vitest run tests/unit/invoice-email.test.ts tests/unit/quote-email.test.ts tests/unit/invoice-email-action.test.ts --reporter=dot`: 24 passed.
- `npx vitest run tests/unit/sales-route-invoice-auth.test.ts --reporter=verbose`: 3 passed.
- `npx tsc --noEmit --pretty false`: failed in unrelated transfer action imports and concurrently added UI tests; no error named a reviewed finance, document, email, or sales-route file.

## Read ledger

Each entry was read in full over the listed inclusive line range; SHA-256 is recorded from the final reviewed tree.

| File | Lines | SHA-256 |
| --- | --- | --- |
| `lib/finance/dates.ts` | 1-24 | `0D0D623F1F1B9AC29E6D27D32955D9BE49023AE9095A89AF608C267DCDC8AE50` |
| `lib/finance/errors.ts` | 1-76 | `459696ED388D15B216F37193679D6D1D8A32270E22010060F6507B1A8C7E5BEA` |
| `lib/finance/invoice-schemas.ts` | 1-41 | `5E865CF93F48F1FC29417D36D08CA7AE95CA1DF0BBFCC763C50ED7B012E4A3D1` |
| `lib/finance/money.ts` | 1-78 | `57749EDD03799088A9DDA06177F683760E1E8B032D05D43B56C8B61B7D3C725F` |
| `lib/finance/payment-policy.ts` | 1-12 | `F2903EBF41ADB1183C73B2F7B8B715783715684DDA7E4D86C04B797EC36B7C00` |
| `lib/finance/permissions.ts` | 1-18 | `64ED339D03B3159D1945A442BF1003A4895848F6E3F1A43DB3F31317F72A8905` |
| `lib/finance/queries.ts` | 1-215 | `218788F96C3B280C5DD8EAECE1F0453AED9CE8B7352337FA7094CE39944E7190` |
| `lib/finance/refunds.ts` | 1-17 | `F5109F83652BA187A162258561B52C9254B1647D0E45A68D7C1F7DC8DF81429B` |
| `lib/finance/types.ts` | 1-76 | `7328EC1C92FA6828AEABAE52F931CC29994EE8D6EDDC643E357ED3C9C60491FE` |
| `lib/finance/validation.ts` | 1-132 | `107AD502ACA67735BC5D6122282EFD5AD1B1574143A5DC01F12C923B7ADEB428` |
| `lib/documents/invoice-pdf.tsx` | 1-95 | `654A987E272C1C85DE6580D24E8B466B0E327716B71D3013BB87B604783231B1` |
| `lib/documents/quote-pdf.tsx` | 1-56 | `A55C55057E5180A5512EF206BF4FFA31141288F998C2CCEFD35D04DB1E3E63F1` |
| `lib/documents/render-invoice-pdf.tsx` | 1-23 | `6A124FF96116F7B9E42DC54FF6321AC9F43F6584BF08E6273CADA6A01CFB056D` |
| `lib/documents/render-quote-pdf.tsx` | 1-16 | `510E94ACABA10514DB87727256EA0C927635181485CEE10CB8022604EF0D6663` |
| `lib/documents/invoice-types.ts` | 1-120 | `AC6252A14E5E7CA5FC1DA429EF2C8F39291B08C0FAB5BCF3B5CB4BB21F9259C3` |
| `lib/documents/quote-types.ts` | 1-77 | `C6C2F58F0680F937E5726859CA658A29F9746FF14E545D8C85649B4B82E0524C` |
| `lib/email/invoice-email.ts` | 1-219 | `E76072085BE3CC79EA5D6418EE52527C3E9E6B18F9B53E842F4CEB0A495F99AF` |
| `lib/email/quote-email.ts` | 1-21 | `0D1DF647A6CB6A458E48C48CC5441E8CD10DC8AE3EB681FE1466DC7F518E3355` |
| `lib/email/send-status.ts` | 1-41 | `D5057E972754C98F5D24997A7DE4773F501CB8355EC1E69AAD41874756CF28C9` |
| `lib/email/quote-send-status.ts` | 1-6 | `A3BE103DB767072D258133A02638162FD941F7BAA979CD20F2DD06450AA0888D` |
| `app/(protected)/invoices/actions.ts` | 1-461 | `8E8C68FC3FD95186D5BF6077902C6B5A982E0D8D22363E4BCE4382FBEFB1FD3D` |
| `app/(protected)/quotes/actions.ts` | 1-62 | `2BA1C5B45C0A69820FA5786907FDC7C136CBD8DC0DA2BF52FA3C14A23C14D3FE` |
| `app/api/sales/customers/route.ts` | 1-13 | `00B21190A4B7CB5B6102E97FB1654D500F639461C75DAAEDFC8D69E2D745C735` |
| `app/api/sales/vehicles/route.ts` | 1-14 | `F7BEBE2897FAB3E14986560234EA0D489508EAA60021C308A1F7ED06F3043550` |
| `app/api/sales/products/route.ts` | 1-16 | `C0D6FE7ADE3002083C3C5135C27A9DCA53DD6319CD7EC5DBCD558BD35FECC2CA` |
| `tests/unit/invoice-pdf.test.tsx` | 1-31 | `86C23A54AC263A4D6423BB3F7713191D507A79572B94BC1BC50C7CF16D122A9B` |
| `tests/unit/quote-pdf.test.tsx` | 1-26 | `3D8CA52649263E362FCD074B6426B89A0EFD78D6212E4A26B92B1E37374FD01E` |
| `tests/unit/invoice-email.test.ts` | 1-100 | `09B0BDF113FD60B6E5B7B8783D347400AC0C62626D1EFB6499D28767E26EB0D7` |
| `tests/unit/quote-email.test.ts` | 1-38 | `8591DD7030E66A578840256FB578F18249621D2C76DBEFC2A6C243B3B4730C39` |
| `tests/unit/invoice-email-action.test.ts` | 1-215 | `3FE9B630DBE9EC7CFBB49A3A974CBD3B26A5964AF53DC4BEED8F28A7180EA98E` |
| `tests/unit/sales-route-invoice-auth.test.ts` | 1-40 | `4ADC7E80ABF2930F2A534B81DBEF91EB9756173A1D951B176DF8B9DAD5D88F5D` |

## Deferred or excluded

- The current `search_customers` and `get_customer` SECURITY DEFINER RPCs still require `customers.view`; an invoice-only user will remain blocked below the repaired HTTP routes until the coordinated forward customer-pricing migration adds the matching invoice capability guard. The current search projection also omits `pricing_tier`, while its TypeScript mapper incorrectly forces every business customer to wholesale. These database and customer-query changes are assigned to the migration owner to avoid parallel migration conflicts.
- PostgreSQL function behaviour and RLS were read against migrations and existing integration coverage only; no local database reset or integration/E2E suite was run in this review task.
- Provider acceptance, reconciliation, and retry timing were reviewed through unit mocks and state-machine code only. No Resend request was made.
- Existing unrelated working-tree edits, including UI, transfer, shell, integration, fixture, and Supabase CLI files, were deliberately not changed.
- Full-suite validation is owned by the parent task. Focused Vitest validation must be rerun after the parent stops/restarts its stalled suite so its result is uncontaminated by that process.
