# EasyPract

Route `/app/easypractice/`. Docs pages: `web/content/{nb,en}/web-apps/easypractice/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://web.archive.org/web/20260718211007/https://system.easypractice.net/api/index.html
- https://easypractice.net/api/

- Mode: fix
- Calls: GET https://system.easypractice.net/api/v1/invoices?order_by_number=desc&page_size=100&page=N with Bearer personal access token (scope invoices-read), reads { data, meta.last_page }, filters by invoice date in the period, skips drafts, NOK only, sums lines[].total per vat/vat_rate. Debits 1900 (paid cash), 1580 (paid other), 1570 (unpaid); sales credited VAT inclusive with ReAI output VAT codes from GET /api/vat-codes via pairVoucherRows; duplicate check via GET /api/vouchers. API only, manual totals form removed. MakePlans dropped from title/docs.
- Hosts in code: `system.easypractice.net`, `web.archive.org`
- Vendor status: Brreg: NUF 928102955 and UTLA 928520773 active, no flags. easypractice.net/nb live and sells the API app.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

The live reference at system.easypractice.net/api/ now redirects to the EasyPractice login, so the July 2026 archived copy was used. How credit notes appear in GET invoices is not documented; non-draft invoices are summed with their signed totals. payment_type values other than 'card' are not documented; anything matching cash/kontant goes to 1900. The shared test provider-api.test.mjs expects the old invented shape (bare list, inv.vat, cardMinor/claimMinor) and will fail.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
