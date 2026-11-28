# Mystore.no Sync

Route `/app/mystore/`. Docs pages: `web/content/{nb,en}/web-apps/mystore/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api-docs.mystore.no/
- https://api-docs.mystore.no/mystore_api_docs.json
- https://support.acendy.com/en/article/create-an-api-key-in-mystore
- https://github.com/mystoreno/acendy-api-client

- Mode: fix
- Calls: GET https://api.mystore.no/shops/{shop}/products and /shops/{shop}/orders?include=order-products,order-totals&sort=-created_at with page[number]/page[size]=50, Bearer personal access token, Accept application/vnd.api+json. Products: sku, name.no, price. Orders: created_at, currency, customer_address_*/billing_address_email; lines from order-products (quantity, final_price net, tax_rate) plus order-totals of type line (value_without_tax, tax_rate); ot_total checks the sum. ReAI: GET /api/orders?externalReference=mystore-{id} duplicate check, GET /api/vat-codes?usage=customer_invoice, POST /api/orders with one line per product/shipping/fee and the output VAT code for the rate; POST /api/products unchanged (title, stockItem, variants[sku, sellingPrice]).
- Hosts in code: `api-docs.mystore.no`, `api.mystore.no`, `auth.mystore.no`
- Vendor status: Brreg 914083095 MYSTORE.NO AS: no konkurs, avvikling or slettedato, 51 employees, accounts filed for 2025. mystore.no live and selling; help centre and PHP client now carry the Acendy name (acendy.com redirects to mystore.no).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/products`
- `/api/vat-codes`

## Caveats

Product price is taken as excluding VAT (osCommerce style; the docs do not state it for products, but order final_price is net per the documented subtotal example). Orders whose lines do not match ot_total within 1 NOK (gift cards, odd discounts) are not offered. Only the latest 50 orders are listed. test/provider-api.test.mjs does not cover mystore, so it is unaffected. Brand: kept 'Mystore' since mystore.no still sells under that name; the coordinator may want to watch the Acendy rename.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
