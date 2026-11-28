# Duell Z-report Accounting

Route `/app/duell/`. Docs pages: `web/content/{nb,en}/web-apps/duell/index.md`.

Purpose: turn one day's Duell Z-reports (GBAT10 accounting lines) into a balanced ReAI review voucher.

## Vendor docs

- Overview: https://www.duell.no/support/api-dokumentasjon/
- Reference: https://api.kasseservice.no/docs/ (auth https://api.kasseservice.no/docs/authentication/, token https://api.kasseservice.no/docs/getaccesstokens/, requests and paging https://api.kasseservice.no/docs/requests/)
- Endpoints: https://api.kasseservice.no/docs/department/list/, https://api.kasseservice.no/docs/z-report/list/, https://api.kasseservice.no/docs/z-report/view/
- Changelog: https://api.kasseservice.no/docs/release-history/

## API version and auth

- `https://api.kasseservice.no/v1`. V1 is the maintained version; the V2 docs say V2 is no longer actively maintained and point to V1. Last GBAT10 change: release 2.32 (2020, dimensions).
- Key: Duell Admin → System → Integrasjoner → API-oppsett gives the client number (avtalenummer) and client token; support@duell.no enables the menu if missing.
- `POST /v1/getaccesstokens` (form `client_number`, `client_token`) returns a JWT, then `Authorization: Bearer <token>`. One token per action.

## Endpoints and paging

- `GET /department/list?filter[is_active]=1&filter[is_deleted]=0&start=0&length=100`
- `GET /account/cashsettlements?department_token=&start_date=<day> 00:00:00&end_date=<day+1> 23:59:59&start=0&length=100`, kept by `cash_settlement_date` = day.
- `GET /account/gbat10?department_id=&cashsettlement_id[]=…` (all of the day's Z-reports in one call per department).
- Paging: listing APIs use `start`/`length` (default length 20, no documented maximum); `length=100` is requested and an error is raised when `total_count` exceeds the rows returned.
- Rate limit: 100 requests per minute per client (`x-duell-ratelimit-*` headers). Departments are read four at a time; at most 15 departments per fetch.

## Subrequest budget

- Fetch: 1 token + 1 departments + per department 1 Z-report list + 1 GBAT10 when it has Z-reports. One department: 4; worst 32.
- Book: 3 (manual vouchers on the day, VAT codes, POST).

## ReAI endpoints

- `GET /api/vouchers?startDate=&endDate=&voucherType=manual` (duplicate marker `Duell Z <numbers> <day>`; reversed vouchers do not block rebooking)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers`

## Accounting mapping

- Each GBAT10 line keeps Duell's `account_number`; øre from `balance`, signed by `balance_type` (credit negative, debit positive).
- Lines with `vatrate_percent` > 0 or `record_type` `sales*` are sales posted including VAT with the ReAI output code (`amountBasis` `vat_inclusive`) for that rate; other lines use VAT code `0`.
- Rows paired with `pairVoucherRows`, currency NOK, review flag set; unbalanced days are shown but cannot be booked. A ReAI company in another currency is refused.

## Caveats

- The documented GBAT10 example does not balance and `gross: "T"` is undefined; no live verification (no credentials).
- Whether `start` is a page index or an offset is unclear in the docs, so only the first page is read and missing rows raise an error.
- Duell's help centre mentions AWS WAF geo-blocking; unverified for Cloudflare egress.

Last verified: 2026-11-28
