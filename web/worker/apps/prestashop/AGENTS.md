# PrestaShop Product & Sales Sync

Route `/app/prestashop/`. Docs pages: `web/content/{nb,en}/web-apps/prestashop/index.md`.

Creates PrestaShop products in ReAI and stages the latest valid PrestaShop orders as ReAI draft orders.

## Vendor API

- Webservice reference: https://devdocs.prestashop-project.org/9/webservice/ and https://devdocs.prestashop-project.org/9/webservice/reference/
- List parameters (display, filter, sort, limit): https://devdocs.prestashop-project.org/9/webservice/tutorials/advanced-use/additional-list-parameters/
- Resources: https://devdocs.prestashop-project.org/9/webservice/resources/products/, .../resources/orders/, .../resources/customers/, .../resources/currencies/
- Key creation: https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/
- Release notes: https://prestashop-project.org/releases/prestashop90
- Admin API (not used): https://devdocs.prestashop-project.org/9/admin-api/

API in use: the core Webservice (`<store>/api/<resource>`, `output_format=JSON`), documented for PrestaShop 9 and present in 1.7 and 8. PrestaShop 9 also ships the Admin API (API Platform, OAuth2), but its docs list no order or customer endpoints yet (not checked against the ps_apiresources source) and the Webservice has no deprecation notice, so the Webservice stays the API that works on every live shop.

Auth: the shop owner enables the Webservice under Advanced Parameters → Webservice and adds a key with GET on `products`, `orders`, `customers` and `currencies`. Sent as HTTP Basic with the key as username and an empty password. The store URL must be public https (SSRF guard).

## Calls

- `GET /api/products?display=[id,reference,name,price]&sort=[id_DESC]&limit=100` (newest 100 products; price is the tax excluded base price in the shop default currency)
- `GET /api/orders?display=[id,reference,id_customer,id_currency,date_add,total_paid_tax_excl,valid]&filter[valid]=[1]&sort=[id_DESC]&limit=50` (newest 50 valid orders, server side filter)
- `GET /api/currencies?display=[id,iso_code]` (order currency)
- `GET /api/customers?display=[id,firstname,lastname,company,email]&filter[id]=[a|b|...]` (one batched call, no N+1)

Subrequests: scan = 4 PrestaShop calls (3 in parallel, then customers) plus ReAI `/api/products` and `/api/customers` pages (200 per page). Create product = 1, stage order = 2. No documented rate limit.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/products` (variants[].sku, duplicate check by SKU), `POST /api/products` (title, stockItem, variants[sku, sellingPrice])
- `GET /api/customers` (match by email, invoiceEmail or name)
- `GET /api/orders?externalReference=prestashop-<id>&pageSize=1` (duplicate check), `POST /api/orders` (customerId, currencyCode from the order, daysUntilDue 14, issueDate/orderDate = order date, externalReference, one line with total_paid_tax_excl)

## Mapping and caveats

- One draft order line with the order total excluding VAT (products, shipping, discounts) and ReAI's default VAT code; the user checks VAT before invoicing. Per line VAT and shipping lines are not split.
- `date_add` is shop local time; its date part is used as order date.
- Only `valid=1` orders are listed, so cancelled and refunded orders are left out; refunds after staging are not followed up.
- Only the newest 100 products and 50 orders are read per scan (no paging beyond that).
- Customers that do not exist in ReAI are not created; the order shows "No matching ReAI customer".

Last verified: 2026-11-28
