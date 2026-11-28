# Paddle Payout Accounting

Route `/app/paddle/`. Docs pages: `web/content/{nb,en}/web-apps/paddle/index.md`.

Books one Paddle Billing payout in ReAI as a review voucher: sales ex. tax, Paddle fees and the
amount received in the bank. Paddle is the merchant of record and collects and remits sales tax.

## Vendor API

- Reports API: https://developer.paddle.com/api-reference/reports/overview
  (create https://developer.paddle.com/api-reference/reports/create-report, get
  https://developer.paddle.com/api-reference/reports/get-report, CSV
  https://developer.paddle.com/api-reference/reports/get-report-csv)
- Payout reconciliation report and columns: https://developer.paddle.com/build/reports/payout-reconciliation
- Auth: https://developer.paddle.com/api-reference/about/authentication
- Versioning: https://developer.paddle.com/api-reference/about/versioning
- Rate limits: https://developer.paddle.com/api-reference/about/rate-limiting
- Changelog: https://developer.paddle.com/changelog (2025 payout reconciliation report, balance report
  deprecated; 2026 filters and new columns; report creation limit raised to 100 per day)
- Machine readable spec: https://github.com/PaddleHQ/paddle-openapi (v1/openapi.yaml)

- API version: Paddle Billing API version 1 (current; Paddle does not deprecate versions today), pinned
  with `Paddle-Version: 1`. Paddle Classic (`vendors.paddle.com`) is not supported.
- Auth: the customer creates an API key in Paddle under Developer tools, Authentication, with report read
  and write permission. Sent as `Authorization: Bearer pdl_live_apikey_...`. Keys starting with
  `pdl_sdbx_` go to `sandbox-api.paddle.com`.
- Hosts in code: `api.paddle.com`, `sandbox-api.paddle.com`, plus the pre-signed CSV link returned by
  Paddle (fetched without credentials).
- Vendor status: Paddle.com Market Ltd (UK), not in Brreg. Paddle Billing is live and sold.

## Endpoints and parameters

1. `POST /reports` with `{ "type": "payout_reconciliation", "filters": [{ "name": "remittance_reference", "operator": null, "value": ["<ref>"] }] }`.
2. `GET /reports/{rep_id}` until `status` is `ready` (up to 4 checks, 2 s apart); `failed` or `expired`
   is an error. If still `pending`, the page offers "Check again" with the report ID, which skips step 1.
3. `GET /reports/{rep_id}/download-url` returns `data.url`, valid for 3 minutes.
4. GET the CSV. Columns read: `remittance_reference`, `balance_movement_type`, `direction`,
   `balance_currency_code`, `payout_created_at` and the `*_in_balance_currency` amounts.

Not used: `GET /transactions` (`per_page` max 30, adjustments have no date filter, misses rebates, SWIFT
and FX fees) and the deprecated `balance` report.

## Budget and limits

- Fetch: 3 to 7 Paddle subrequests (create, up to 4 status checks, download link, CSV); "Check again": 3 to 6. Book: `GET /api/vouchers` (1 page usually),
  `GET /api/vat-codes`, `POST /api/manual-vouchers`.
- Paddle allows 240 requests per minute per IP; 429 blocks the IP for 60 s and is shown with Retry-After.
  Report creation is limited to 100 per day per account.
- The shared CSV parser accepts at most 5,000 rows per report.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true` (duplicate check on the description prefix
  `Paddle payout <remittance reference>`)
- `GET /api/vat-codes` (code `52` must exist with rate 0 and type exempt or outside scope)
- `POST /api/manual-vouchers` with `pairVoucherRows`, `reviewReason` set

## Accounting mapping

Each row must satisfy Paddle's formula: gross - tax - Paddle fee - retained fee - FX fee - FX precision
- chargeback fee + rebates and SWIFT fees = balance movement. The sum of balance movements must equal
the payout amount the user enters from the remittance advice.

- Debit bank account (default `1920`): amount received in the bank, VAT `0`.
- Credit sales account (default `3100`): sales ex. tax (gross - tax, refunds and chargebacks netted),
  VAT `52` (export to Paddle, zero rated).
- Debit fee account (default `7770`): the remainder, i.e. Paddle, retained, FX and chargeback fees net of
  rebates and SWIFT fees, VAT `0`.
- If the balance currency differs from the company currency, the user enters the amount received in the
  company currency and every line is converted at that rate; postings are in the company currency.

## Caveats and unverified assumptions

- The report page does not state whether CSV amounts are decimals or minor units. Values with a decimal
  point are read as major units; otherwise the unit is chosen by matching the entered payout amount.
- Sign convention of `direction=out` rows is not documented; a row with a positive movement and
  direction `out` is negated, and every row is checked against the formula.
- VAT treatment (sale to Paddle as export with code 52, fees without reverse charge because Paddle is a
  reseller) is a common reading, not confirmed by Paddle; the voucher is flagged for review.
- Chargebee was named in an earlier version but never called. It is a billing layer on top of a payment
  gateway, not a merchant of record, so it was dropped here; a Chargebee invoice import would be its own
  slug.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
