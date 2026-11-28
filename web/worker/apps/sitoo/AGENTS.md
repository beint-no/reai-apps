# Sitoo POS Z-report Accounting

Route `/app/sitoo/`. Docs pages: `web/content/{nb,en}/web-apps/sitoo/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.sitoo.com/introduction
- https://developer.sitoo.com/api-reference/z-reports
- https://developer.sitoo.com/api-reference/overview

- Mode: api
- Auth: Customer generates an API user password in Sitoo Backoffice under Settings / Sitoo REST API (Administrator, API extension required); app sends Authorization: Basic base64(API ID:password) to the account base URL (default https://api.mysitoo.com) with the account ID.
- Hosts in code: `api.mysitoo.com`, `developer.sitoo.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Sitoo Norge NUF). sitoo.com live, sells Sitoo POS.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

No public email on sitoo.com (contact and partner pages use forms only); use the form at https://sitoo.com/contact or https://sitoo.com/partners/technology-partners. Uses GET /v2/accounts/{id}/pos-z-reports (plain array, max 500, paged by dateadded), filters by datecreated in Europe/Oslo. Store Z-reports need Sitoo backend config and are not used. Sales are posted gross with ReAI VAT codes 3/31/33 (vat_inclusive) and 5 for 0% (zero-rated), verified against GET /api/vat-codes before booking; tenders: cash 1900, gift card 2900, invoice 1570, others 1580; roundoff 7790. Refund sign in vatgroupsrefund/paymentsrefund is not documented, so absolute values are used. If the customer IP-restricts the API key, Worker egress IPs must be allowed. NOK only.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
