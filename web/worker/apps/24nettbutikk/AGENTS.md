# 24Nettbutikk Sync

Route `/app/24nettbutikk/`. Docs pages: `web/content/{nb,en}/web-apps/24nettbutikk/index.md`.

Purpose: read products and one month of paid orders from a 24Nettbutikk shop, create missing products in ReAI and stage paid orders as ReAI orders with the shop's VAT rates.

## Vendor docs

- Reference (Sincos Software AS, the company behind 24Nettbutikk): https://github.com/SincosSoftware/webshop_api/wiki/API-Documentation
- Resources: https://github.com/SincosSoftware/webshop_api/wiki/orders, https://github.com/SincosSoftware/webshop_api/wiki/products, https://github.com/SincosSoftware/webshop_api/wiki/customers
- API key (24Next admin): https://support.24nettbutikk.no/knowledge/slik-genererer-du-api-n%C3%B8kler
- Changelog: none published. The wiki was last edited in 2021.

## API version and auth

- `https://<shop>/api/v1`, the only version documented. No newer API or deprecation notice found (2026-11-28).
- Key: click your name in 24Next admin, choose API Nøkler, Generer tilfeldig kode (shown once). Legacy admin: `/admin/index.php?nr=103`.
- Header: `Authorization: Basic base64(<token>:x-oauth-basic)`.

## Endpoints and paging

- `GET /api/v1/products/250/{offset}`: all products, oldest first.
- `GET /api/v1/orders/250/{offset}/{since}`: `since` is a unix time one day before the month start; time based paging filters and sorts on `modified_on`. Kept locally: `paid`, not `deleted`, status not `cancelled`/`rejected`, `order_date` in the month.
- `GET /api/v1/customers/{customer_id}`: one per distinct customer on the kept orders (no batch endpoint), at most 20 per scan with five in flight.
- Paging: `limit`/`offset` URI segments, `{ data, paging: { next } }`. The offset advances by the rows returned and paging stops when `paging.next` is absent, so a server cap on `limit` cannot skip rows. No maximum `limit` is documented (250 is used). Caps: six pages each for products and orders; more raises an error instead of truncating.
- Rate limits: none documented.

## Subrequest budget

- Scan: product pages (usually 1) + order pages (usually 1) + customer lookups (at most 20) + ReAI product pages (at most 5). Typical 5 to 25, worst 37.
- Create product: 3 (SKU check, VAT codes, POST). Stage order: 3 or 4 (customer lookup by org no then email, VAT codes, POST).

## ReAI endpoints

- `GET /api/products` (pages for the SKU overview; `query=<sku>` re-check before create), `POST /api/products`
- `GET /api/customers?organizationNumber=` then `?email=` (exact server-side filters)
- `GET /api/vat-codes?usage=customer_invoice`
- `POST /api/orders` with `externalReference` `24nettbutikk-<order_no>`; ReAI returns 409 for a duplicate.

## Accounting mapping

- Product: title, SKU (`article_no`, else `24NB-<id>`), price as stored, `vatCode` for the product VAT %.
- Order: one line per shop line, net = `total_amount_gross - total_vat` in øre, VAT code from the line VAT %; the rest of the order net (shipping, payment surcharge) is one line at the order VAT %. Currency from the order and must equal the ReAI company currency. `orderDate` and `issueDate` = `order_date`.
- Orders with gift cards (or a negative rest) and orders whose customer was not loaded are shown but not staged.

## Caveats

- Not confirmed that 24Next keys use the same `/api/v1` Basic auth as the wiki; no live verification.
- The product resource does not say whether `price` includes VAT; the UI copies it and warns.
- Customer matching uses ReAI's primary email filter; an invoice email alone does not match.
- `limit` 250 is an assumption (the documented default is 100); the paging is safe either way.

Last verified: 2026-11-28
