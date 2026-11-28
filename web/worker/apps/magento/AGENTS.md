# Magento Sync

Route `/app/magento/`. Docs pages: `web/content/{nb,en}/web-apps/magento/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/
- https://developer.adobe.com/commerce/webapi/rest/quick-reference/
- https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/
- https://experienceleague.adobe.com/en/docs/commerce-operations/release/notes/adobe-commerce/2-4-4

- Mode: fix
- Calls: GET /rest/V1/products?searchCriteria[pageSize]=50&currentPage=1 and GET /rest/V1/orders with filter_groups state in processing,complete and created_at gteq <from>, sorted by created_at DESC. Total excl. VAT = grand_total - tax_amount, order currency passed to ReAI, stockItem from type_id, GET /api/orders?externalReference=magento-<id>&status=all before POST /api/orders. Docs and UI hint describe the integration token setup and the OAuth Consumer Settings switch.
- Hosts in code: `developer.adobe.com`, `shop.example.no`
- Vendor status: Magento Open Source and Adobe Commerce 2.4.x are maintained and sold by Adobe; REST docs on developer.adobe.com current.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/products`

## Caveats

Product price is taken as stored in Magento (may include VAT depending on store config). Only the first 50 products and orders are read. Orders become one line with the default customer VAT code. The 2.4.4 standalone bearer setting is documented by Adobe as not recommended; the alternative is full OAuth 1.0a, which this single-request app does not implement.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
