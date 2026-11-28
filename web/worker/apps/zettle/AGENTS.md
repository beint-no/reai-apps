# PayPal POS (Zettle) Reconcile

Route `/app/zettle/`. Docs pages: `web/content/{nb,en}/web-apps/zettle/index.md`.

Read-only: lists PayPal Point of Sale (formerly Zettle) payouts from the liquid account for one
month, matches them against pending ReAI bank transactions and exports a CSV. Nothing is booked.

## Vendor docs

- Finance API overview: https://developer.zettle.com/docs/api/finance/overview
- Reference (v2): https://developer.zettle.com/docs/api/finance/reference
- Fetch transactions guide: https://developer.zettle.com/docs/api/finance/user-guides/fetch-account-transactions
- Auth (assertion grant): https://developer.zettle.com/docs/api/oauth/user-guides/set-up-app-authorisation/set-up-authorisation-assertion-grant
- API key link: https://developer.zettle.com/docs/get-started/user-guides/create-app-credentials/create-app-credentials-for-self-hosted-app/create-credentials-self-hosted-app
- The GitHub repo iZettle/api-documentation is deprecated since 2022-05-09; do not use it.
- Changelog: none published on the portal.

## API version

Finance API v2 (`https://finance.izettle.com/v2`); v1 is deprecated. No v3 or sunset announced.

## Auth

The merchant creates an API key at https://my.zettle.com/apps/api-keys (the UI links it
prefilled with `?name=ReAI&scopes=READ:FINANCE`) and copies the client ID shown with it.
`POST https://oauth.zettle.com/token` (form: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
`client_id`, `assertion=<API key>`), then `Authorization: Bearer <access_token>`. One token per action.

## Endpoints used

- `GET /v2/accounts/liquid/balance` for `currencyId` (transactions carry no currency).
- `GET /v2/accounts/liquid/transactions?start&end&includeTransactionType=PAYOUT&includeTransactionType=FAILED_PAYOUT&limit=10000&offset`
  `start` inclusive, `end` exclusive, UTC `YYYY-MM-DDThh:mm:ss`, set to 00:00 Europe/Oslo of the
  month bounds. `limit` max 10000; next page only when a full page returns (max 5).

## Budget per action

Review: 1 token + balance and first page in parallel + 1 ReAI bank read = 4 subrequests.
No rate limits documented; 429 gives a retry message.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/company-banks`
- `GET /api/bank-reconciliations/{bankAccountId}?month&include=pending_transactions`

## Mapping

Negative `PAYOUT` amounts (minor units, string or number) become payouts of `-amount`; positive
PAYOUT (PayPal Wallet back to liquid) is ignored. A `FAILED_PAYOUT` with the same originating
uuid removes the payout. Date = Oslo day of `timestamp` (UTC, offset optional). Reference = the
uuid. Both `originatingTransactionUuid` (guide) and `originatorTransactionUuid` (reference) and
both a bare array (reference) and `{ data: [...] }` (guide) are accepted.

## Caveats

- That a FAILED_PAYOUT carries the voided payout's uuid is assumed; unmatched failures are only
  counted in a warning.
- With the PayPal linked model payouts can go to the PayPal Wallet, so some will not match a bank line.
- Slug and URL stay `zettle`.

Last verified: 2026-11-28
