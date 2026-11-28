# Wix Stores Sync

Route `/app/wix/`. Docs pages: `web/content/{nb,en}/web-apps/wix/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/search-orders
- https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key

- Mode: fix
- Calls: POST https://www.wixapis.com/ecom/v1/orders/search with filter paymentStatus $eq PAID and createdDate $gte/$lt, cursorPaging limit 100 and metadata.cursors.next. One ReAI order line per lineItem (totalPriceBeforeTax, taxInfo.taxRate decimal) plus shippingInfo.cost.totalPriceBeforeTax with its tax rate; VAT codes from /api/vat-codes?usage=customer_invoice; currency from order; duplicate check via /api/orders?externalReference; customer find or create (company when billing company set). Product sync removed.
- Hosts in code: `dev.wix.com`, `www.wixapis.com`
- Vendor status: Wix eCommerce REST APIs are live and documented at dev.wix.com (Search Orders page current, examples dated 2026).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/vat-codes`

## Caveats

Product sync removed (Catalog V1 vs V3 split; V3 query does not return variants). Not tested against a live site.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
