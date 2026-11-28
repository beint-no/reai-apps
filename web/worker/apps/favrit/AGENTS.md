# Favrit

Route `/app/favrit/`. Docs pages: `web/content/{nb,en}/web-apps/favrit/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://support.favrit.com/getting-started-1
- https://support.favrit.com/authentication
- https://support.favrit.com/important-urls-and-models
- https://support.favrit.com/user-location-api-documentation
- https://support.favrit.com/accounting-api-documentation
- https://support.favrit.com/orderline-api-documentation

- Mode: fix
- Calls: POST https://accounting-api-auth.favrit.com/oauth2/token (Basic ClientId:SecretId, client_credentials, scope prod/accounting [+ prod/user]); GET https://favrit.com/ws/accounting-api-service/v1/api/user/locations when no location id; GET .../v1/api/accounting/locations/{id}/settlements filtered by creationDate; GET .../settlements/{sid}/reports?type=json. Sales per accountReference and vatPercent (fraction) from sumWithVat, delivery fee 3000 at 25 %, tips 2930, totalPaymentFee 7770, payout clearing 1580. ReAI output VAT codes from GET /api/vat-codes, pairVoucherRows, duplicate check. API only; manual form removed. Does not call the PUT that marks settlements complete.
- Hosts in code: `accounting-api-auth.favrit.com`, `favrit.com`, `support.favrit.com`
- Vendor status: Brreg: no flags, 24 employees. support.favrit.com developer docs updated August 2026.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Favrit marks the Accounting API as 'will be deprecated in the near future' (notice since Dec 2023) and points to the Orderline API (CSV, 24 h window, no fees or settlement grouping). If Favrit retires it, switch to GET /api/orderlines/v6/{location}. The settlements list is described as 'sync able settlement_ids'; settlements already marked complete by another integration may not be listed (status parameter values undocumented). deliveryFee treatment is undocumented; booked as 25 % revenue on 3000. The shared test provider-api.test.mjs calls fetchFavrit with { apiToken } and a single mock route, so it will fail.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
