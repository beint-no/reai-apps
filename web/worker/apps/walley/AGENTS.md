# Walley Settlement Reconcile

Route `/app/walley/`. Docs pages: `web/content/{nb,en}/web-apps/walley/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://dev.walleypay.com/docs/reports/overview
- https://dev.walleypay.com/docs/reports/authentication
- https://dev.walleypay.com/docs/reports/endpoints
- https://dev.walleypay.com/docs/reports/settlements-api/search
- https://dev.walleypay.com/docs/reports/settlements-api/settlements
- https://dev.walleypay.com/openapi/walley-api.json

- Mode: api
- Auth: Merchant creates an API key in Walley Merchant Hub (name menu > Manage Organization > Create new > Api key) and gets client ID + secret. App does OAuth2 client_credentials POST https://api.walleypay.com/oauth2/v2.0/token with documented PROD scope a3f3019f-2be9-41cc-a254-7bb347238e89/.default, then Authorization: Bearer <access_token>.
- Hosts in code: `api.walleypay.com`, `dev.walleypay.com`
- Vendor status: Swedish company, no Norwegian register entry found by name. walley.no live with merchant and consumer offering.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

GET /reports/settlements?query=startDate:>=<month start - 45d> AND endDate:<=<month end>&page&perPage=100 (documented query syntax), then filtered on paidOutAt within the month. Payout = totalAmount, fees = |compensations|. Whether fees are deducted or invoiced depends on the merchant agreement. Read-only reconcile + CSV like klarna.js; nothing is booked. No dedicated Norwegian partner/integration address found; help@walley.se is Merchant Services in the dev portal footer.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
