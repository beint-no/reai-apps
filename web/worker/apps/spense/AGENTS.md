# Spense Settlement Reconcile

Route `/app/spense/`. Docs pages: `web/content/{nb,en}/web-apps/spense/index.md`.

Purpose: import a Spense settlement CSV, match each net payout to pending ReAI bank transactions, export the
reconciliation and optionally create one balanced review voucher per month.

## Vendor docs

- Guides: https://developer.spensepay.com/guides/getting-started, https://developer.spensepay.com/guides/settlements
- Auth: https://developer.spensepay.com/guides/authenticating
- Reference: https://developer.spensepay.com/apis/partner/settlements (OpenAPI
  https://developer.spensepay.com/_bundle/apis/partner.json?download)
- Changelog: none published

## API version and mode

Partner API `v1` (OpenAPI 3.1, server `https://api.spensepay.com/partner`). The app stays on CSV upload: re-checked
2026-11-28, `GET /settlements/generate_csv` still requires a JSON request body (`from_date`, `to_date`, `format`,
`test_mode`, `payout_type`, `exclude_providers`) and documents no query parameters; `POST` to the same path returns
405. Worker fetch cannot send a body on GET. Switch to API mode if Spense adds a POST or query variant.

## Auth

None in the app. For reference: client ID and secret from Spense Portal (app.spensepay.com), OAuth2
client_credentials at `POST /partner/auth/token`, scope `organization:accounting:read`, optional `X-Organization-Id`.

## Input formats

- payouts: `Date of payout,Payment provider,Reference,Currency,Gross Amount,Fees,Net Amount`
- transactions: `Date of transaction,Payment provider,Settlement reference,Settlement paid at,Reference,Currency,Gross amount,Fees,Net amount,Payment type,Payment method`,
  grouped by settlement reference and currency, dated by `Settlement paid at`
- machine_readable is not supported (ragged rows).

Timestamps carry a UTC offset and are converted to the Europe/Oslo day. Amounts become integer minor units. Currency
comes from each row; only rows in the ReAI company currency and the chosen month are used.

## ReAI endpoints

- `GET /api/company-banks`, `GET /api/bank-reconciliations/{bankId}?month&include=pending_transactions`
- Voucher: `GET /api/vouchers?startDate&endDate&voucherType=manual` (paged, duplicate check), `POST /api/manual-vouchers`

Subrequests: review 2 ReAI calls; voucher 2 plus one per 200 manual vouchers in the month.

## Accounting mapping

One review voucher per month, dated on the last payout. Per payout: bank (selected `companyBankId`) debit net /
clearing `1580` credit; fees withheld (gross minus net, when positive) `7770` debit / clearing credit. All postings use
VAT code `0` (bank and settlement rows; payment fees carry no VAT). Each pair has its own `rowNumber`, so
`pairVoucherRows` is not needed. Any non reversed manual voucher whose description starts with
`Spense settlements <YYYY-MM> ` blocks a second voucher for that month.

## Caveats

- The documented transactions example leaves Fees and Net amount empty; then net = gross and no fee is booked.
- Fees Spense invoices later are not booked. Whether the Spense Portal UI offers the CSV download is not documented.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Vouchers use real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
