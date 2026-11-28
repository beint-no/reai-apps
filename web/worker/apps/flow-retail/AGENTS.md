# Flow Retail Daily Accounting

Route `/app/flow-retail/`. Docs pages: `web/content/{nb,en}/web-apps/flow-retail/index.md`.

## Purpose

Turns the Flow Retail accounting report for one day into one balanced ReAI manual voucher flagged for review.

## Vendor docs

- OpenAPI (YAML): https://api.flowretail.com/v2/spec
- Accounting report endpoint: https://docs.flowretail.com/docs/developers/api-documentation/reports/accounting-report-for-stores-json-format.md
- ERP guide (one report per day after close): https://docs.flowretail.com/docs/integrations/erp.md
- Auth: https://docs.flowretail.com/docs/developers/authentication.md
- Amount scale: https://docs.flowretail.com/docs/developers/quantity-and-price-representation.md
- Changelog (monthly release notes, API section and "Deprecated and removed"): https://docs.flowretail.com/docs/november-2026.md
- Developer landing: https://www.flowretail.com/for-utviklere

## API version and auth

- Flow Retail API v2 (`info.version` 2.0.0), base `https://api.flowretail.com/v2`; the only public version. No deprecation notices for the endpoints used (checked November 2026 release notes).
- Key: Flow Retail Admin → Users → New User, account type Integration, permission REPORTING, generate an integration token (shown once). API access from the Flow Pro plan.
- Header `Authorization: Bearer <integration token>`.

## Endpoints used

- `GET /tenants/{tenantUid}/organizations?pageNumber=1&pageSize=100` only when the organization id is blank; exactly one active organization is required.
- `POST /tenants/{tenantUid}/reports/accounting` with `{fromDate, toDate, organizationUid}` (same day). Postings are already aggregated; no paging.

## Paging, limits, subrequest budget

- No rate limit is documented for these endpoints (429 is documented only for the service portal).
- Fetch action: 1 or 2 Flow calls. Book action: `GET /api/vouchers` for the day (usually 1 page) + `GET /api/vat-codes` + `POST /api/manual-vouchers` = 3.

## ReAI endpoints

- `GET /api/vouchers?startDate&endDate&includeReversed=true` (duplicate check on description prefix `Flow Retail <store> <date>`)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers` with `reviewReason`, postings from `pairVoucherRows`

## Accounting mapping

- Amounts are integers with two implied decimals (øre). Signed = `debetAmount − creditAmount`; postings without a 4 digit account or with zero amount are skipped.
- Identical postings repeated across the `asset`, `debet`, `credit` and `ledger` arrays are counted once; booking is blocked unless debit equals credit.
- Revenue lines (3xxx with a VAT code other than 0) are posted including VAT with Flow's VAT code, which must be a ReAI `vat_inclusive` output code; ReAI splits base and VAT.
- When Flow reports VAT on separate 27xx lines, that VAT is added back to the revenue lines with the same VAT code (proportional, remainder on the last line) and no 27xx line is posted (ReAI reserves those accounts). A VAT line whose code matches no revenue line gives an error naming the account and code.
- All other lines (cash, terminals, Vipps, rounding, receivables) use their Flow account with VAT code 0.
- Currency NOK; booking is refused when the ReAI company currency is not NOK (the report has no currency field).

## Caveats

- The docs do not define how the four arrays differ or which totals balance; deduplication plus the balance check is the guard. No documented example response; not verified against a live tenant.
- Flow's `vatCode` is assumed to equal the ReAI (SAF-T standard) code; the book step rejects unknown or non output codes.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
