# Flow Retail Daily Accounting

Route `/app/flow-retail/`. Docs pages: `web/content/{nb,en}/web-apps/flow-retail/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://www.flowretail.com/for-utviklere
- https://api.flowretail.com/v2/spec
- https://docs.flowretail.com/docs/developers/authentication.md
- https://docs.flowretail.com/docs/integrations/erp.md
- https://docs.flowretail.com/docs/developers/api-documentation/reports/accounting-report-for-stores-json-format.md
- https://docs.flowretail.com/docs/developers/quantity-and-price-representation.md
- https://docs.flowretail.com/docs/getting-started/users-and-roles/users.md

- Mode: api
- Auth: Customer (Flow Pro plan or higher) creates a user with Account type Integration in Flow Retail Admin (Users > New User), grants REPORTING, and generates an integration token; sent as Authorization: Bearer to https://api.flowretail.com/v2. Tenant id (tenantUid) is shown in Flow Retail Admin.
- Hosts in code: `api.flowretail.com`, `docs.flowretail.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. Annual accounts filed for 2025. flowretail.com live, sells POS and webshop.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Uses the vendor-recommended POST /tenants/{tenantUid}/reports/accounting ({fromDate, toDate, organizationUid}); when organizationUid is blank, GET /tenants/{tenantUid}/organizations must return exactly one active organization. The docs do not define how asset/debet/credit/ledger differ, the amount unit for these postings (general convention: integers with two implied decimals) or the vatCode standard; identical postings across sections are deduplicated and booking is blocked unless debit equals credit. If the report has a 27xx VAT line, postings are kept with ReAI vatCode 0; otherwise credit lines on 3xxx accounts with a non-zero vatCode are posted VAT-inclusive with Flow's vatCode, which must exist as a ReAI output code (else a clear error). No example response exists in the docs; no live verification. Flow Start plan has no API access; licence policy says API access may count as one user licence.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
