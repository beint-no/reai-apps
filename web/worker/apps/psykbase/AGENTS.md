# PsykBase Clinic Invoice Accounting

Route `/app/psykbase/`. Docs pages: `web/content/{nb,en}/web-apps/psykbase/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://help.psykbase.no/nb/articles/204383-api
- https://system.easypractice.net/api/index.html
- https://web.archive.org/web/20260718211007/https://system.easypractice.net/api/index.html
- https://easypractice.net/api/

- Mode: api
- Auth: Customer activates the API app in PsykBase, opens API settings and creates a Personal Access Token (scope invoices-read); app sends Authorization: Bearer <token> to https://system.psykbase.no/api/v1.
- Hosts in code: `help.psykbase.no`, `system.easypractice.net`, `system.psykbase.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Aspit AS, named on psykbase.no). psykbase.no live, sells the journal system for psychologists.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

PsykBase (Aspit) runs on the EasyPractice platform: the PsykBase help article links to the EasyPractice API reference, and system.psykbase.no/api/v1/invoices answers 401 JSON like the EasyPractice API. The reference now requires login; field names were taken from the public Wayback copy of 2026-07-18. Other addresses: support@aspit.no (psykbase.no/kontakt-oss), api@easypractice.net (developer, on easypractice.net/api). GET api/v1/invoices has no date filter, so the app pages order_by_number=desc (page_size 100, max 30 pages) and filters on date client side. Health services posted on 3200 with VAT code 6; taxable lines on 3000/3010/3020 with 3/31/33. Paid card/other -> 1580, cash -> 1900, everything else (unpaid, transfer, health_insurance) -> 1570. Norwegian menu labels (Apper, API-innstillinger) in the nb doc are inferred from the English EasyPractice docs. How credit notes appear (separate negative invoices vs 'credited' flag) is not documented. Note: the existing easypractice.js uses query params from/to that are not in the EasyPractice reference (the reference documents id, number, client_id, paid, unpaid, order_by_number, page_size, page).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
