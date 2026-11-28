# Rackbeat Product Sync

Route `/app/rackbeat/`. Docs pages: `web/content/{nb,en}/web-apps/rackbeat/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.rackbeat.com/reference/authentication-1
- https://developer.rackbeat.com/reference/getproducts
- https://developer.rackbeat.com/reference/pagination
- https://developer.rackbeat.com/reference/customizable-requests
- https://developer.rackbeat.com/llms.txt

- Mode: api
- Auth: Customer creates a personal API key in Rackbeat under Company settings > API (shown once, optional scopes). Authorization: Bearer <key>.
- Hosts in code: `app.rackbeat.com`, `developer.rackbeat.com`
- Vendor status: Danish company, no Norwegian register entry. rackbeat.com live and sells inventory management; its footer CVR 29403473 resolves to Visma e-conomic A/S (active, not bankrupt, per cvrapi.dk).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/products`

## Caveats

GET https://app.rackbeat.com/api/products?fields=number,name,barcode,sales_price,cost_price,stock_quantity,is_barred&is_barred=false&page=N&limit=100 (pagination returns HTTP 206 with products/total/pages/limit/page; max limit not documented, loop follows `pages`, cap 50 pages). Modeled on ongoing-wms/shopware product sync: creates missing ReAI products by SKU on click, with a re-check by SKU before create. Stock quantity shown only; ReAI inventory is deliberately not set to avoid creating stock movements.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
