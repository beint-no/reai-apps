# Amendo Z-report Accounting

Route `/app/amendo/`. Docs pages: `web/content/{nb,en}/web-apps/amendo/index.md`.

Purpose: total the Amendo Z-reports (dagsoppgjør) signed on one day into one balanced ReAI review
voucher, sales by VAT rate and payments by payment type.

## Vendor docs

- Reference and auth (Tellix ProTouch web API, which the Amendo back office runs on): https://api.tellix.no/api/doc
- ProTouch blueprint: https://jsapi.apiary.io/apis/tellixprotouch.apib
- Vendor and API access: https://amendo.no/om-oss/ ("åpent API på forespørsel"), https://amendo.no/integrasjoner/
- No public changelog. The reference lists `v3` as the only `{version}` value.

## API version

`https://api.tellix.no/web/v3`, the only documented version.

## Auth

Amendo support issues an API username, password and API key to existing customers on request. One
`POST /web/v3/getaccesstoken` (form `username`, `password`, `apikey`) per action returns
`{ token }` (valid 6 hours), sent as the raw `Authorization` header (no `Bearer`). Requests also
send `Source: ReAI Apps`.

## Endpoints

- `GET /web/v3/zreport/list?offset&limit=100`. `limit` is required; no date filter and no documented
  sort order or max limit. Response `{ status, data[], totalCount }`.

Paging: the module detects the sort order from the first page (`signDate` of first vs last row).
Newest first: page forward and stop once a page's oldest day is before the chosen day. Oldest first:
if the first page already passes the day stop, else walk back from the last page (`totalCount`)
and stop once a page's oldest day is before the chosen day. Unknown order: scan forward. Max 20
pages; if the day is not reached, the error asks for a more recent date.

## Budget

Fetch: 1 token + 1 to 20 list pages (typically 2 to 4). Book: `GET /api/vouchers` (1 page per 200
vouchers that day) + `GET /api/vat-codes` + `POST /api/manual-vouchers`. No rate limit is documented.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true`: duplicate check on description prefix
  `Amendo Z <numbers> <date>`.
- `GET /api/vat-codes`: output VAT code per rate (`vat_inclusive`, not reverse charge).
- `POST /api/manual-vouchers` with `reviewReason`, postings built by `pairVoucherRows`.

## Mapping

Reports with `signDate` (fallback `cashSettlementDate`, `YYYY/MM/DD`) equal to the day and
`IsZReport` not false, deduplicated by `cashSettlementId`.

| Source | Account |
| --- | --- |
| `paymentMethodTurnover[].amount` with `paymentType` starting `Kontant`/`cash` | debit `1900` |
| other payment types (card, Vipps, Faktura) | debit `1580` |
| `vatTurnover[].turnoverInclVat` less `returnVatTurnover[]` per `vatRatePercent` | credit `3000` (25), `3010` (15), `3020` (12), `3100` other, ReAI output VAT code |
| non VAT lines | VAT code `0` |

Currency is NOK (the Z-report has no currency field; receipts in the same API report `NOK`).

## Caveats

- Not verified against a live account.
- `issuedGiftCards`, `issuedCreditNotes`, `prefillVouchersValue` and `totalRoundOff` are not mapped; a
  day with these shows a difference and cannot be booked.
- Gift card redemptions arrive as a payment type and go to `1580`.
- Error 104 "WebShop Integration module is disabled" suggests a module must be enabled by Amendo.
- `api.tellix.no` is not named on Amendo's site (found via `bo.tellix.no`).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
