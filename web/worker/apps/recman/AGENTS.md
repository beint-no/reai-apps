# RecMan Invoices & Payroll

Route `/app/recman/` (export `handleRecMan`). Helpers in `core.js` (this app only). Docs pages: `web/content/{nb,en}/web-apps/recman/index.md`.

Imports issued RecMan invoices and credit notes (with original PDF and KID) as booked ReAI invoices, and prepares draft ReAI payroll runs from unexported RecMan paychecks, with workplace municipality (AGA zone) lookup through Kartverket.

## Vendor API

- Overview, URLs and quota: https://help.recman.io/hc/en-us/articles/11866067675154-API-in-RecMan (updated 2026-11-20)
- Invoices, credit notes, PDFs: https://help.recman.io/hc/en-us/articles/38572087044370 (updated 2026-11-18)
- Paychecks: https://help.recman.io/hc/en-us/articles/38573936360210 (updated 2026-11-19)
- Postman collection (all requests): https://help.recman.io/hc/article_attachments/40964162069138
- Developer category: https://help.recman.io/hc/en-us (For developers)
- Kartverket address search: https://ws.geonorge.no/adresser/v1/ (served at `https://api.kartverket.no/adresser/v1/sok`)
- Changelog: none published; articles carry update dates.

API version: RecMan API v2 (`https://api.recman.io/v2/get/`), the only documented version.

Auth: read-only (SELECT) API key created by a system administrator under System settings → Database → API → Create, sent as the `key` query parameter (never logged).

Scopes used (GET, `page` paging with `nextPage`, 1000 rows per page): `invoice` (`minInvoiceId`), `creditNote` (`minCreditNoteId`), `invoicePdf` (`invoiceId`), `creditNotePdf` (`creditNoteId`), `company` (`fields=name,number,vatNumber,visitAddress`), `product`, `paycheck` (`exported=0`, `minPaycheckId`), `candidate` (`isEmployee=1`, `fields=firstName,lastName,email,employment`), `project` (`fields=name,companyId`), `work` (`workIds` batches of 100), `corporation` (key test).

Quota and budget: RecMan includes 200 free requests per day and bills lookups beyond that. The client stops at 45 RecMan calls per action. Invoice scan: 4 RecMan scopes (1 page each per 1000 rows) plus ReAI customers, VAT codes, accounts and invoices pages. Book click: 1 RecMan PDF call plus 2 to 4 ReAI calls. Payroll scan: 4 scopes plus 1 `work` call per 100 work IDs, plus at most 20 Kartverket lookups (14 addresses, fallbacks within budget), plus 2 ReAI calls. RecMan has no date filter on invoices; `minInvoiceId` / `minCreditNoteId` / `minPaycheckId` are the server-side narrowing, and the start date is applied locally.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers`, `POST /api/customers`
- `GET /api/vat-codes?usage=customer_invoice`, `GET /api/chart-of-accounts/accounts?accountNumberPrefix=3`
- `GET /api/invoices?startDate=` (duplicate check by invoice number)
- `POST /api/orders`, `GET /api/orders?externalReference=` (on 409)
- `POST /api/invoices/import` (`source=recman`, `externalId`, `snapshotLines`, `originalPdf`, `accounting=book`)
- `GET /api/employees`, `POST /api/employees`, `GET/PUT /api/employees/{id}`
- `GET /api/salary-settings`, `POST /api/salary-payments`, `GET /api/salary-payments/{id}`, `POST /api/salary-payments/{id}/wage-specs`

## Mapping

Invoice lines keep RecMan's net, VAT, revenue account (`creditAccount`, line or product) and VAT code; the VAT code must exist in ReAI with the same rate, otherwise the row is blocked with a message. Credit notes are negated. Paycheck lines map to ReAI wage codes suggested from the RecMan article name (editable). Employment dates are kept only when they are real dates (`ongoing` → no end date).

## Caveats

- NOK companies only.
- Payroll body fields were spot-checked against the contract, not exhaustively.
- Addresses beyond the Kartverket budget stay unresolved and the municipality is entered by hand.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
