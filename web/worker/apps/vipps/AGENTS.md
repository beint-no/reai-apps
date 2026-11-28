# Vipps Reconcile

Route `/app/vipps/`. Docs pages: `web/content/{nb,en}/web-apps/vipps/index.md`.

Lists Vipps MobilePay scheduled payouts for one month and matches them against pending ReAI bank
transactions; exports a CSV. Writes nothing to ReAI.

## Vendor docs

- Reference (OpenAPI): https://developer.vippsmobilepay.com/redocusaurus/report-swagger-id.yaml (rendered at https://developer.vippsmobilepay.com/api/report)
- Guide: https://developer.vippsmobilepay.com/docs/APIs/report-api/api-guide/fetching-report-data/
- Entry types: https://developer.vippsmobilepay.com/docs/APIs/report-api/api-guide/entry-types/
- Auth: https://developer.vippsmobilepay.com/docs/APIs/report-api/report-api-quick-start/ and https://developer.vippsmobilepay.com/docs/knowledge-base/api-keys/
- Changelog: https://developer.vippsmobilepay.com/docs/APIs/report-api/CHANGELOG/

## API

- Version: Report API `report/v2` (final since September 2023; v1 deprecated, `ledgertransactions`
  removed May 2024) and `settlement/v1/ledgers`. No newer version or sunset announced.
- Keys: the sales unit's production `client_id`, `client_secret`, `Ocp-Apim-Subscription-Key` and MSN
  (business portal → For developers → Production → Show keys). `POST /accesstoken/get` with those as
  headers; later calls send `Authorization: Bearer`, `Ocp-Apim-Subscription-Key`, `Merchant-Serial-Number`
  and `Vipps-System-*` headers.
- `GET /settlement/v1/ledgers` (cursor paging, empty cursor ends). Since February 2025 each ledger
  belongs to one sales unit; the ledger whose `settlesForRecipientHandles` ends with the MSN is used.
- `GET /report/v2/ledgers/{ledgerId}/funds/dates/{ledgerDate}` once per ledger date of the month up to
  today in Europe/Oslo, following `cursor` while `hasMore`. There is no date range parameter; the feed
  endpoint has no start date. Six dates run in parallel.
- `payout-scheduled` entries (last entry of a ledger date when a payout is made) become payouts:
  `amount` is negative minor units, `pspReference` is `<ledgerId>-<payoutNumber>`, `reference` is the
  bank transfer text. `tryLater: true` marks an open date and is shown as a note.
- `404` means no access to the ledger (or no ledger) and is reported, not skipped. `429` is reported.
  No rate limit is documented. Page size defaults to 1000 entries.

## Subrequests per action

- Review: 2 + one per ledger date (up to 31) + extra pages + 1 ReAI bank reconciliation lookup, so
  about 34 for a full month. Provider calls are capped at 45; above that the review stops with a message.
- Page load: 1 (ReAI company banks).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/company-banks`
- `GET /api/bank-reconciliations/{bankAccountId}?month&include=pending_transactions`

## Caveats

- Vippsnummer sales units cannot use the Report API (they must use an accounting partner or the
  business portal report).
- Only payouts in the ReAI company currency are listed; others are counted as excluded.
- Ledger dates follow the merchant's cutoff (normally midnight local time), not UTC.
- Merchants with more than 1000 entries on many days hit the call cap; Vipps can raise the page size per ledger.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
