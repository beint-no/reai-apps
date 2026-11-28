# Mystore.no Sync

Route `/app/mystore/`. Docs pages: `web/content/{nb,en}/web-apps/mystore/index.md`.

Creates missing Mystore products in ReAI by SKU and stages Mystore orders from a chosen date as ReAI orders with one
line per product, shipping or fee and the VAT rate from Mystore.

## Vendor API

- Reference: https://api-docs.mystore.no/ (OpenAPI: https://api-docs.mystore.no/mystore_api_docs.json)
- Token: https://support.acendy.com/en/article/create-an-api-key-in-mystore
- Official PHP client (shows current usage): https://github.com/mystoreno/acendy-api-client
- No changelog or versioned paths published.

Version: the single unversioned JSON:API at `https://api.mystore.no/shops/{shop}/`.

Auth: the store admin logs in at https://auth.mystore.no/login, creates a Personal Access Token (valid 10 years) with
scopes `products:read` and `orders:read`. Headers: `Authorization: Bearer`, `Accept: application/vnd.api+json`,
`User-Agent: ReAI Apps (apps.reai.no)` (the docs ask for an identifying user agent).

## Endpoints

- `GET /products?filter[sku][path]=sku&filter[sku][value]=(empty)&filter[sku][operator]=<>&sort=sku`
- `GET /orders?include=order-products,order-totals,order-status&filter[created_at][path]=created_at&filter[created_at][value]=<from> 00:00:00...<today> 23:59:59&filter[created_at][operator]=between&sort=-created_at`
- Paging: `page[number]`, `page[size]=50` (documented maximum); continue while a page is full and `links.next` exists
  or `links.last` is further on. At most 8 product pages and 6 order pages, else a clear error.
- Rate limit: 120 requests per minute per token.

Subrequest budget: scan = 2 to 14 Mystore calls + ReAI product and customer pages. Create product = 2. Stage order = 3.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/products` (all pages per scan; `?query=<sku>` before create), `POST /api/products`
- `GET /api/customers` (all pages per scan)
- `GET /api/orders?externalReference=mystore-<id>&status=all&pageSize=1`, `GET /api/vat-codes?usage=customer_invoice`,
  `POST /api/orders`

## Mapping

Product: `sku`, `name.no` (or first translation), `price` → variant `sellingPrice`. Order lines from `order-products`
(`quantity`, `final_price` net, `tax_rate`) plus `order-totals` with `order_total_type=line` (`value_without_tax`,
`tax_rate`); `ot_total` must match the lines within 1 NOK. Each line gets the ReAI output VAT code for its rate.
Customer matched by email or name. External reference `mystore-<id>`.

## Caveats

- Product `price` is taken as excluding VAT (osCommerce style; not stated for products).
- `created_at` is taken as Norwegian local time (the docs show no zone).
- Orders with a `credit_note` or a status name like Kansellert or Returnert (names are shop configurable) are shown
  but not offered. Non-NOK orders are not offered.
- The help centre and PHP client now carry the Acendy name; mystore.no still sells under Mystore.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
