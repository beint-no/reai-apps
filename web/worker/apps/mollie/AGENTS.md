# Mollie Settlement Reconcile

Route `/app/mollie/`. Docs pages: `web/content/{nb,en}/web-apps/mollie/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.mollie.com/reference/list-settlements.md (GET /v2/settlements, OpenAPI embedded)
- https://docs.mollie.com/reference/authentication.md (API keys, advanced access tokens)
- https://docs.mollie.com/reference/pagination.md
- https://docs.mollie.com/llms.txt (index and changelog notes)
- https://www.mollie.com/no

- API version: Mollie API v2 (only current version).
- Auth: advanced access token (`access_…`) created by an admin under Developers → API keys (https://my.mollie.com/dashboard/developers/api-access-tokens) with `settlements.read`; sent as `Authorization: Bearer <token>`. Website profile API keys (`live_…`) cannot read settlements and are rejected before any call.
- Endpoint: `GET https://api.mollie.com/v2/settlements?year=<y>&month=<m>&currencies=<company currency>&limit=250`, cursor paging by following `_links.next.href` (checked to stay on the same endpoint), at most 4 pages per month. The docs do not say which date `year`/`month` filters on, so the previous month is read too and settlements are kept by `settledAt` (Oslo day) in the chosen month, `status` `paidout`.
- Fields read: `id`, `reference` (bank reference), `settledAt`, `status`, `amount{currency,value}` (decimal string), `invoiceId`, `periods.<year>.<month>.revenue[].amountGross` and `.costs[].amountGross`.
- Subrequests: 2 to 8 Mollie calls, 1 ReAI bank reconciliation read (plus the bank list on page load).
- Vendor status: Mollie B.V. (Netherlands), no Norwegian entity in Brreg; mollie.com/no sells to Norwegian merchants with NOK settlement and Vipps.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used (through `web/worker/lib/reconcile.js`):

- `GET /api/company-banks`
- `GET /api/bank-reconciliations/{bankId}?month=&include=pending_transactions`

## Accounting mapping

None booked. Payout = `amount`; fees column = sum of `costs[].amountGross`; detail shows payment volume (sum of `revenue[].amountGross`) and the Mollie invoice id. Matching uses the shared ±8 day rule with the settlement reference.

## Caveats

No live verification (no credentials). Mollie invoices its costs separately (`invoiceId`); booking those costs and their VAT treatment stays with the user. Contact: partners@mollie.com (docs.mollie.com/llms.txt).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
