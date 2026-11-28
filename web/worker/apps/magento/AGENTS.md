# Magento Sync

Route `/app/magento/`. Docs pages: `web/content/{nb,en}/web-apps/magento/index.md`.

Reads the Magento 2 / Adobe Commerce catalog and processing or complete orders, creates missing ReAI products by SKU
and stages orders as ReAI orders.

## Vendor API

- REST reference: https://developer.adobe.com/commerce/webapi/rest/quick-reference/
- Search criteria: https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/
- Filtered responses (`fields`): https://developer.adobe.com/commerce/webapi/rest/use-rest/retrieve-filtered-responses/
- Input limits (maximum page size): https://developer.adobe.com/commerce/webapi/get-started/api-security
- Auth: https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/
- Release notes: https://experienceleague.adobe.com/en/docs/commerce-operations/release/notes/adobe-commerce/2-4-9

Version: REST `V1` (the only REST version), current on Magento Open Source / Adobe Commerce 2.4.9 (GA 2026-05-12).

Auth: the merchant creates an integration under System → Extensions → Integrations with read access to Catalog and
Sales, activates it and copies the Access Token, sent as `Authorization: Bearer`. Since 2.4.4 this needs Stores →
Configuration → Services → OAuth → Consumer Settings → Allow OAuth Access Tokens to be used as standalone Bearer tokens
= Yes (Adobe marks this as not recommended; full OAuth 1.0a is not implemented here).

## Endpoints

- `GET /rest/V1/products?searchCriteria[sortOrders]=entity_id ASC&fields=items[sku,name,price,type_id],total_count`
- `GET /rest/V1/orders` with filter groups `state in processing,complete` AND `created_at gteq <Oslo midnight in UTC>`,
  sorted `created_at DESC`, `fields=items[entity_id,increment_id,created_at,customer_firstname,customer_lastname,customer_email,billing_address[firstname,lastname,company],grand_total,tax_amount,total_refunded,order_currency_code,status,state],total_count`
- Paging: `searchCriteria[pageSize]=300` (Adobe's default maximum when input limits are on), `currentPage` until
  `total_count` is reached (Magento repeats the last page past the end), at most 5 pages per list.

Subrequest budget: scan = 2 to 10 Magento calls in parallel + ReAI product and customer pages. Create product = 2.
Stage order = 2.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/products` (all pages per scan; `?query=<sku>` before create), `POST /api/products`
- `GET /api/customers` (all pages per scan)
- `GET /api/orders?externalReference=magento-<entity_id>&status=all` before `POST /api/orders`

## Mapping

Product → ReAI product (`title`, `stockItem` false for virtual/downloadable, variant `sku`, `sellingPrice` = Magento
price). Order → ReAI order with one line, `unitPrice` = `grand_total − tax_amount` in the order currency
(`order_currency_code`), default customer VAT code, customer matched by email or name. `created_at` (UTC) becomes its
Europe/Oslo day.

## Caveats

- Catalog prices may include VAT depending on store tax settings; the UI labels them "Magento price".
- Orders with `total_refunded > 0` are shown but not staged.
- A merchant with a lower custom maximum page size gets an HTTP 400 from Magento.
- Adobe Commerce as a Cloud Service (SaaS) uses IMS credentials and a different host; not supported.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
