# Ongoing WMS

Route `/app/ongoing-wms/`. Docs pages: `web/content/{nb,en}/web-apps/ongoing-wms/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.ongoingwarehouse.com/REST/v1/index.html
- https://developer.ongoingwarehouse.com/REST/v1/openapi.json
- https://developer.ongoingwarehouse.com/authentication
- https://docs.ongoingwarehouse.com/manuals/api-access

- Mode: fix
- Calls: Exported fetchApi(creds, fetchImpl) builds https://api.ongoingsystems.se/{warehouse}/api/v1/articles from a validated warehouse name, pages with articleSystemIdFrom + maxArticlesToGet=200, supports Basic or OAuth 2.0 client credentials (POST https://login.ongoingwms.com/connect/token, scope goodsowner:articles:read), reads documented articleNumber, articleName, isActive, customerPrice, purchasePrice, barCodeInfo.barCode, inventoryInfo.numberOfItems. Creates ReAI products via POST /api/products {title, stockItem, variants[{sku, sellingPrice, costPrice, barcode}]} (verified against ProductReq/ProductVariantReq); SKU diff via GET /api/products (paginated). Docs NB/EN rewritten with Administration → API for goods owners.
- Hosts in code: `api.ongoingsystems.se`, `developer.ongoingwarehouse.com`, `docs.ongoingwarehouse.com`, `login.ongoingwms.com`
- Vendor status: ongoingwarehouse.com live (200); Goods Owner REST API OpenAPI file at developer.ongoingwarehouse.com/REST/v1/openapi.json actively versioned (version=58), docs built 2026.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/products`

## Caveats

Swedish company, not in Brønnøysund. Demo systems use wms1.ongoingsystems.se and are not supported. customerPrice semantics (incl./excl. VAT) not stated by Ongoing; sellingPrice is passed through as is.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
