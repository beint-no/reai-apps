# Nexi Checkout Payout Reconcile

Route `/app/nets/`. Docs pages: `web/content/{nb,en}/web-apps/nets/index.md`.

Reads Nexi Checkout (formerly Nets Easy) payouts for one month and matches them against pending
ReAI bank transactions. Read only: nothing is booked. Result downloads as CSV.

## Vendor docs

- Reporting API reference: https://developer.nexigroup.com/nexi-checkout/en-EU/api/reporting-v1/
- Environments and auth: https://developer.nexigroup.com/nexi-checkout/en-EU/api/
- Keys: https://developer.nexigroup.com/nexi-checkout/en-EU/docs/access-your-integration-keys/
- Changelog: https://developer.nexigroup.com/nexi-checkout/en-EU/change-log/

## API version

Reporting API v1 (`/report/v1/...`), the only version. No sunset announced; the 2026 changelog
has no Reporting API entries. Deprecated fields `feeVATpercent` and `vatAmount` are not read.

## Auth

The merchant copies the live secret key from the Nexi Checkout portal (Company > Integration).
Sent as `Authorization: <secret key>` with no scheme. Keys starting with `test-` go to
`https://test.api.dibspayment.eu`, all others to `https://api.dibspayment.eu`.
`merchantNumber` is only for partner keys and is sent only when entered.

## Endpoints

- `GET /report/v1/payouts?fromDate&toDate&currency&pageNumber&pageSize=100[&merchantNumber]`:
  full dates, zero based `pageNumber`, documented default page size 100 (no maximum stated).
  `currency` is the ReAI company currency (documented server-side filter).
  Reads `id`, `reference`, `date`, `currency`, `amount`, `fees`, `feeTaxAmount`, `chargedAmount`,
  `refundedAmount` (all minor units).
- Paging stops on a short page or when `numberOfPayouts` is reached; more than 20 pages (2000
  payouts) throws instead of truncating.

## Budget and limits

One review: 1 Nexi call for a normal month (one per 100 payouts) plus 1 ReAI call. The page
load makes 1 ReAI call for banks. No rate limits documented; `429` gives a wait message.

## ReAI API

- `GET /api/company-banks` (via `loadActiveBanks`)
- `GET /api/bank-reconciliations/{bankId}?month&include=pending_transactions`

## Accounting mapping

None booked. `amount` is the net payout to the bank; `fees` is what Nexi withheld. The docs page
shows typical accounts (1580 clearing, 7770 fees, 1920 bank) for the user's own posting.

## Caveats

- Keys are accepted with or without the type prefix; a test key without `test-` would go to the
  live host and be rejected.
- Not tested against a live key.

Last verified: 2026-11-28
