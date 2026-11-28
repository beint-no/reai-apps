# LetsReg Settlement Accounting

Route `/app/letsreg/`. Docs pages: `web/content/{nb,en}/web-apps/letsreg/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://help.letsreg.com/nb/articles/13598282-api-integration (token flow, organiser administrator login, elevated permissions on request)
- https://integrate.deltager.no/index.html (Swagger UI)
- https://integrate.deltager.no/swagger/v1/swagger.json (Deltager Integration API 2.2.8)

- API version: Deltager Integration API 2.2.8 (only version published).
- Auth: OAuth2 password grant, `POST https://legacyapi.deltager.no/token` with form `grant_type=password&username=&password=&affid=` (help article). `affid` is the site id (1 for letsreg.no per the example). Then `Authorization: bearer <access_token>`. Swagger's own `tokenUrl` (`/swagger/token`, username `affid:username`) is the UI helper and is not used.
- Endpoints on `https://integrate.deltager.no`:
  - `GET /organizers?Offset=0&Limit=100` only when no organiser id is entered (must return exactly one).
  - `GET /organizers/{organizerId}/settlements`: last 20 settlements; needs an elevated API role that LetsReg support enables. Fields `id`, `grossAmount`, `netAmount`, `payoutDate`, `reference`, `accountNumber`.
  - `GET /organizers/{organizerId}/settlements/{settlementId}`: SettlementDetail[] with `orderId`, `grossAmount`, `vatAmount`, `fee`, `netAmount` (decimal NOK).
- Paging: settlements are not paged (latest 20); settlements are filtered on `payoutDate` within the month (date-times without offset are read as Norwegian local time).
- Subrequests: 1 token, 0 to 1 organisers, 1 settlements, up to 20 details (5 in parallel), so at most 23. Book: 1 to 2 voucher pages, 1 VAT codes, 1 POST.
- Vendor status: Brreg 982111986 DELTAGER AS (LetsReg): not konkurs, not under avvikling, no slettedato (2026-11-28).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/vouchers` (duplicate check on `LetsReg settlement <reference> <date>`)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers` with `pairVoucherRows`

## Accounting mapping

- Per settlement: revenue per VAT rate (rate implied from `vatAmount / (grossAmount - vatAmount)`, must be 25, 15, 12 or 0) credited on `3000`/`3010`/`3020`/`3100` VAT-inclusive; `fee` debited on `7770` without VAT; gross minus fees debited on `1580`.
- Booking is blocked unless the sum of order `netAmount` equals the settlement `netAmount`.

## Caveats

No live verification (no credentials). Currency is not in the schema; NOK is assumed and the ReAI company must use NOK. Whether the LetsReg fee carries VAT is not documented, so it is posted without input VAT. `discount` is assumed already deducted from `grossAmount`. Only the latest 20 settlements are reachable. Contact: support@letsreg.no (https://www.letsreg.com/no/hjelp/support/).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
