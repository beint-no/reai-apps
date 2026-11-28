# Svea Checkout Settlement Reconcile

Route `/app/svea/`. Docs pages: `web/content/{nb,en}/web-apps/svea/index.md`.

Matches daily Svea Checkout payouts for one month against pending ReAI bank transactions and exports a CSV.
Read only; nothing is booked.

## Vendor docs

- Reference: https://paymentsdocs.svea.com/docs/manage-order/reports/
- Auth: https://paymentsdocs.svea.com/docs/getting-started/authentication/
- Hosts and units: https://paymentsdocs.svea.com/docs/getting-started/before-you-start/

## API version

Payment Admin API `v2` reports (`/api/v2/reports`), the current and only reports version; no sunset announced.

## Auth

Checkout merchant ID and secret key issued by Svea with the Checkout agreement (ask Svea; no self service).
Reconciliation reports must be activated by Svea. Headers: `Timestamp: yyyy-MM-dd HH:mm:ss` (UTC) and
`Authorization: Svea base64(merchantId + ':' + UPPER(hex(SHA512(body + secret + timestamp))))`, body empty for
GET (the docs' code samples use upper hex). Secret never stored.

## Endpoints

`GET https://paymentadminapi.svea.com/api/v2/reports?date=YYYY-MM-DD&includeWithholding=true`. The endpoint
takes one date; no range or paging exists. Dates today or later are rejected by Svea, so the month is clipped
to yesterday (UTC). `404` means no report generated (no payout) and counts as an empty day; `400` stops with a
message to ask Svea to activate reports.

## Budget

- Review one month: up to 31 Svea requests (6 in parallel) plus 1 `GET /api/bank-reconciliations/{bankId}`
  in parallel. At most 32. Page load: 1 `GET /api/company-banks`.
- No rate limit documented; no retry logic.

## ReAI endpoints

`GET /api/company-banks`, `GET /api/bank-reconciliations/{bankId}?month&include=pending_transactions`
(via `web/worker/lib/reconcile.js`).

## Mapping

- Payout per `clientReports[]`: `paymentReport.sveaPaidAmountIncludingWithholding` ("paid amount including
  opening balance"), date `reconciliationDate`, currency `paymentReport.currency`.
- Fees: `feeAmountExcludingVat + feeVatAmount`.
- Amounts are integer minor units (Long; before-you-start states minor units; example 39800 = 2 x 19900).
- Only payouts in the company currency are matched; others are counted as excluded. Zero or negative payouts
  are skipped.

## Caveats

- Only Svea Checkout with Svea as payment facilitator; the Finnish Svea Payments (ex Maksuturva) product is
  not covered.
- Assumes `sveaPaidAmountIncludingWithholding` equals the bank payout; verify with a real report.
- Weekend dates are still requested because the docs do not say reports are banking days only.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
