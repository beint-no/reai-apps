# Rackbeat Product Sync

Route `/app/rackbeat/`. Docs pages: `web/content/{nb,en}/web-apps/rackbeat/index.md`.

Compares sellable Rackbeat products with ReAI Products by SKU and creates missing ones on click (title, SKU, sales price, cost price, barcode). Stock quantity is shown only.

## Vendor API

- Index: https://developer.rackbeat.com/llms.txt
- Auth: https://developer.rackbeat.com/reference/authentication-1
- List products: https://developer.rackbeat.com/reference/getproducts
- Pagination: https://developer.rackbeat.com/reference/pagination
- Errors and rate limits: https://developer.rackbeat.com/reference/errors
- Field selection: https://developer.rackbeat.com/reference/customizable-requests
- Changelog: none published.

API version: the only REST API (`https://app.rackbeat.com/api`, spec version 1.0.0, unversioned paths).

Auth: personal API key from Rackbeat Company settings → API, header `Authorization: Bearer <key>`.

Endpoint: `GET /products?fields=number,name,barcode,sales_price,cost_price,stock_quantity,is_barred&is_barred=false&is_sellable=true&page=N&limit=100`. Response `products[]` with `total, pages, limit, page` (HTTP 206).

Paging and budget: page/limit, loop follows `pages`, capped at 30 pages of 100 (largest limit not documented; default 20). Scan action: 1 Rackbeat request per 100 products (at most 30) plus ReAI product pages of 200; the UI warns when Rackbeat reports more products than were scanned. Create click: 2 ReAI requests (SKU search, create). Rate limit 480 requests per minute per account (`429`).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/products` (all, and `?query=<sku>` re-check before create)
- `POST /api/products` (`title, stockItem: true, variants: [{ sku, sellingPrice, costPrice, barcode? }]`)

## Mapping

Rackbeat `number` → SKU (case-insensitive match against all variant SKUs), `name` → title, `sales_price` → `sellingPrice`, `cost_price` → `costPrice` (rounded to two decimals), `barcode` → `barcode`. ReAI inventory is not set, to avoid stock movements.

## Caveats

- Rackbeat prices are in the Rackbeat company's base currency, which the API does not expose (`/self` has no currency); the app assumes it matches the ReAI company currency.
- Rackbeat sales prices are excluding VAT; the ReAI contract does not say whether `sellingPrice` includes VAT.
- The spec types prices as integer in examples; real values are decimals and are parsed as numbers.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
