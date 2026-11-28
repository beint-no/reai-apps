# Klarna Reconcile

Route `/app/klarna/`. Docs pages: `web/content/{nb,en}/web-apps/klarna/index.md`.

Read only: lists Klarna payouts for a month and matches them against pending ReAI bank transactions,
with a CSV export. Nothing is booked.

## Vendor API

- Reference (Settlements API, Swagger 2.0, info.version `1.0.0-rc2`, basePath `/settlements/v1`):
  https://docs.klarna.com/acquirer/klarna/api/settlements/
- Authentication: https://docs.klarna.com/api/authentication/
- Settlement reports: https://docs.klarna.com/settlement-reports/
- Newer platform (not used, see caveats): Klarna Management API `GET /v2/settlements` on
  `api-global.klarna.com`, https://docs.klarna.com/acquirer/klarna-network/api/klarna-management-api/

Version: Settlements API v1 is the version documented for Klarna direct merchants under
`/acquirer/klarna/`. No deprecation or sunset notice found on 2026-11-28 (the portal lists it under
its "legacy" spec label, but there is no replacement for these merchants and no removal date).

Auth: the merchant creates a live API key (`klarna_live_api_…`) in the Klarna Partner Portal or gets one
from Klarna merchant support. Sent as `Authorization: Basic <API key>` (documented format, not base64
of user:password). Host `api.klarna.com` (Europe).

## Endpoints

`GET /settlements/v1/payouts` with `start_date` and `end_date` (full date-time, Klarna recommends an
explicit end time), `currency_code` (company currency, server side), `size=500` (documented maximum),
`offset`. Reads `payouts[].payment_reference`, `payout_date`, `currency_code`,
`merchant_settlement_type` and `totals.{settlement_amount, sale_amount, return_amount, fee_amount,
holdback_amount}` (integer minor units), `pagination.total`.

The month is converted to Europe/Oslo bounds (for October: `2026-09-30T22:00:00Z` to
`2026-10-31T22:59:59Z`) and payout dates are shown as Oslo days.

## Paging, limits, budget

Offset paging stops when a page is shorter than 500 or `pagination.total` is reached; at most 10 pages.
Rate limits are not published for this API; `429` gives a clear retry message. One review costs one
Klarna request (more only beyond 500 payouts a month) plus one ReAI request; page load costs one.

## ReAI API

- `GET /api/company-banks` (page load, via `lib/reconcile.js`).
- `GET /api/bank-reconciliations/{bankAccountId}?month=YYYY-MM&include=pending_transactions`.

## Accounting

None booked. Docs advise a 1580 clearing account and fees on 7770. Matching (shared helper): same
currency, exact amount, within 8 days, by `payment_reference` in the bank text or a unique amount.

## Caveats

- Merchants onboarded on the newer Klarna Network platform get settlements from the Management API
  (`/v2/settlements`, max 30 day window, payout reference only via a per settlement payout status
  call). Not implemented; v1 keys from those accounts may be rejected.
- Only live keys and the European host are supported.

Last verified: 2026-11-28.
