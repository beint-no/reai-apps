# Ongoing WMS Warehouse Sync

Route `/app/ongoing-wms/`. Docs pages: `web/content/{nb,en}/web-apps/ongoing-wms/index.md`.

Reads the goods owner's articles from Ongoing WMS (a 3PL warehouse system) and creates missing
article numbers as ReAI stock products. Stock levels in ReAI are not changed.

## Vendor docs

- Goods Owner REST API reference: https://developer.ongoingwarehouse.com/REST/v1/index.html
- OpenAPI file: https://developer.ongoingwarehouse.com/REST/v1/openapi.json (UTF-8 BOM)
- Authentication: https://developer.ongoingwarehouse.com/authentication
- Scopes: https://developer.ongoingwarehouse.com/goods-owner-scopes
- Pagination: https://developer.ongoingwarehouse.com/paginating-responses
- Rate limits: https://developer.ongoingwarehouse.com/rate-limits
- API user setup for the warehouse: https://docs.ongoingwarehouse.com/manuals/api-access

## API version

Goods Owner REST API v1 (`https://api.ongoingsystems.se/{warehouse}/api/v1/`), the current and
only REST version. No sunset announced. Demo systems (`wms1.ongoingsystems.se`) are not supported.

## Auth

The warehouse creates a goods owner API user under Administration > API for goods owners and
gives the customer the goods owner ID. OAuth 2.0 (recommended): one
`POST https://login.ongoingwms.com/connect/token` per scan with form fields `grant_type=client_credentials`,
`client_id`, `client_secret`, `scope=goodsowner:articles:read`, then `Authorization: Bearer`.
Basic: `Authorization: Basic base64(user:password)` on each call.

## Endpoints

- `GET /api/v1/articles?goodsOwnerId&articleSystemIdFrom&maxArticlesToGet=1000`: documented
  pagination takes the highest `articleSystemId` plus one until a short or empty page (guide uses
  1000 per page). Reads `articleNumber`, `articleName`, `isActive`, `customerPrice`,
  `purchasePrice`, `barCodeInfo.barCode`, `inventoryInfo.numberOfItems`; inactive articles skipped.

## Budget and limits

Scan: 1 token (OAuth only) + 1 Ongoing call per 1000 articles (max 10, then an error) + ReAI
products at 200 per page. Create: 2 ReAI calls. Limits are per method and client; `429` carries
`Retry-After` in seconds, which the error message shows. No retry loop.

## ReAI API

- `GET /api/products` (all pages, SKU diff)
- `GET /api/products?query=<sku>` (duplicate check before create, exact variant SKU match)
- `POST /api/products` `{ title, stockItem: true, variants: [{ sku, sellingPrice, costPrice?, barcode? }] }`

## Accounting mapping

Products only; no vouchers. Revenue account and VAT code use ReAI defaults.

## Caveats

- Ongoing does not state whether `customerPrice` includes VAT; it is passed through as
  `sellingPrice` unchanged. Currency is not converted.
- Swedish vendor, not in Brønnøysund.
- Not tested against a live API user.

Last verified: 2026-11-28
