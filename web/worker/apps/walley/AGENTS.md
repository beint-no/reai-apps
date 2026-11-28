# Walley Settlement Reconcile

Route `/app/walley/`. Docs pages: `web/content/{nb,en}/web-apps/walley/index.md`.

Read-only: lists Walley settlements paid out in one month, matches each payout against pending
ReAI bank transactions and exports a CSV. Nothing is booked.

## Vendor docs

- Overview: https://dev.walleypay.com/docs/reports/overview
- Auth: https://dev.walleypay.com/docs/reports/authentication
- Hosts: https://dev.walleypay.com/docs/reports/endpoints
- Reference: https://dev.walleypay.com/docs/reports/settlements-api/search, https://dev.walleypay.com/docs/reports/settlements-api/settlements
- OpenAPI: https://dev.walleypay.com/openapi/walley-api.json
- Changelog: https://feed.walleypay.com/ (product feed; no API changelog or version number published)

## API version

Reports API on `https://api.walleypay.com/reports` (unversioned paths). No newer version or
sunset announced as of the verification date.

## Auth

Merchant Hub: name menu > Manage Organization > Create new > Api key gives a client ID and secret.
`POST https://api.walleypay.com/oauth2/v2.0/token` (form: `client_id`, `client_secret`,
`grant_type=client_credentials`, `scope=a3f3019f-2be9-41cc-a254-7bb347238e89/.default`, the
documented PROD scope), then `Authorization: Bearer <access_token>`. One token per action.

## Endpoints used

- `GET /reports/settlements?query=startDate:>=<month start - 45d> AND endDate:<=<month end> AND currency:<company currency>&page=N&perPage=1000`
  (documented query syntax; perPage max 1000). Stops at `metaData.numberOfPages`, max 5 pages.
  `paidOutAt` is not filterable, so payouts are kept when `paidOutAt` (ISO with offset) falls in
  the month on the Europe/Oslo calendar.

## Budget per action

Review: 1 token + 1 settlements page (normal) + 1 ReAI bank read = 3 subrequests. No rate limits
documented; 429 surfaces as an HTTP error via `fetchJson`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/company-banks` (page load, bank picker)
- `GET /api/bank-reconciliations/{bankAccountId}?month&include=pending_transactions`

## Mapping

Payout = `totalAmount` (decimal, major units) to minor units with `Math.round(x*100)`; fees =
`|compensations|`; currency from the settlement; reference = `reference` (only present when the
merchant enabled settlement references) or the settlement id. Matching uses
`lib/reconcile.js` (amount, ±8 days, reference in bank text).

## Caveats

- Whether fees are deducted or invoiced depends on the merchant agreement.
- Settlements with `totalAmount <= 0` (negative carried balance) are not listed.
- Amount units and the sign of `compensations` are inferred from the example; not verified live.
- Merchant Services contact: help@walley.se (dev portal footer).

Last verified: 2026-11-28
