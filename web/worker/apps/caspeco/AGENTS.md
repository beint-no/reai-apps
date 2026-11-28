# Caspeco Daily Sales Accounting

Route `/app/caspeco/`. Docs pages: `web/content/{nb,en}/web-apps/caspeco/index.md`.

Purpose: total one Caspeco business day of sales lines into one balanced ReAI review voucher, sales by
VAT rate, payments by payment type and tips payable.

## Vendor docs

- Export API overview (auth, URL, limits, business day): https://developers.caspeco.se/v1/guides/sales-export-api/overview/
- Data specification (fields): https://developers.caspeco.se/v1/guides/sales-export-api/data-specification/
- Reference: https://developers.caspeco.se/v1/api/analytics/operations/exportapi_sales/
- Portal and current APIs: https://developers.caspeco.se/
- No public changelog.

## API version

Classic Sales Export API (`https://salesapi.caspeco.net/api/sales`). Caspeco lists it under Classic
APIs: "still supported for existing integrations, but we recommend using the latest APIs for new
projects". The newer Analytics API (OAuth client credentials at id.caspeco.se, sales with receipt
payment amounts) needs a Caspeco partner application and integration that Caspeco sets up, so a
customer cannot get a key for it. Switch when ReAI becomes a Caspeco partner or the classic API gets
a sunset date.

## Auth

Caspeco support issues an AuthKey and the customer's system name. Header `AuthKey: <key>`.

## Endpoints

- `GET /api/sales/{system}/{YYYY-MM-DD}`, JSON array of sales lines for the business day 06:00:00
  to 05:59:59 the next day. No paging.

## Budget and limits

Fetch: 1 request. Book: `GET /api/vouchers` (1 page per 200 vouchers that day) + `GET /api/vat-codes`
+ `POST /api/manual-vouchers`. Caspeco allows 100 requests per day per AuthKey; `429` is reported
without retry.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true`: duplicate check on description prefix
  `Caspeco <system> <date>`.
- `GET /api/vat-codes`: output VAT code per rate (`vat_inclusive`, not reverse charge).
- `POST /api/manual-vouchers` with `reviewReason`, postings built by `pairVoucherRows`.

## Mapping

Fields are read case-insensitively; rows with `EmptyGroup` true are skipped.

| Source | Account |
| --- | --- |
| `SalesExVat + SalesVat` per line, rate from `SalesVat / SalesExVat` snapped to 25, 15, 12 or 0 | credit `3000`, `3010`, `3020`, `3100`, ReAI output VAT code |
| same gross per line grouped by `Payment`; labels starting `cash`/`kontant` | debit `1900` |
| other payment types | debit `1580` |
| `TicketTip` once per `RecieptId` (`ReceiptId` accepted) | debit on that receipt's payment type, credit `2930` |

Sum of `DiscountExVat + DiscountVat` is shown as a warning for comparison, not posted. Currency is
NOK (the export has no currency field).

## Caveats

- Not verified against a live account.
- Payment amounts are not in the export (`Payment` is an internal code), so payments mirror sales and
  split tender receipts follow the line's type. The voucher always balances; compare with the
  Caspeco day report.
- Not documented whether `SalesExVat` is net of discounts or whether returns are negative lines.
- Swedish Caspeco systems report SEK; only NOK companies should use this.
- Caspeco also owns Trivec.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
