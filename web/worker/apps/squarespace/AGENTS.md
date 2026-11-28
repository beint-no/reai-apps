# Squarespace

Route `/app/squarespace/`. Docs pages: `web/content/{nb,en}/web-apps/squarespace/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.squarespace.com/commerce-apis/retrieve-all-orders
- https://developers.squarespace.com/commerce-apis/authentication-and-permissions
- https://developers.squarespace.com/commerce-apis/making-requests

- Mode: fix
- Calls: GET https://api.squarespace.com/1.0/commerce/orders with Authorization: Bearer <key> and User-Agent; modifiedAfter/modifiedBefore window then cursor paging (pagination.nextPageCursor), filter createdOn in range, skip fulfillmentStatus CANCELED. Lines from lineItems[].unitPricePaid, shippingTotal, discountTotal; VAT rate derived from taxTotal (order level) and priceTaxInterpretation, applied only when it matches 25/15/12/0. Staged as ReAI orders with duplicate check, customer find or create, VAT codes from /api/vat-codes?usage=customer_invoice. BigCommerce removed from brand, title and docs.
- Hosts in code: `api.squarespace.com`, `developers.squarespace.com`
- Vendor status: Squarespace Commerce and its Commerce APIs are live (developers.squarespace.com retrieve-all-orders page served 200 on 2026-11-28).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/vat-codes`

## Caveats

Developer API keys need a Commerce plan (Commerce Advanced per Squarespace docs; some guides say Premium too). Squarespace gives tax only per order, so mixed rate orders fall back to the ReAI default VAT code. If BigCommerce is wanted it needs its own module. Not tested against a live store.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
