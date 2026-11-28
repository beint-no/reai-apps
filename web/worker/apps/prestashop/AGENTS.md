# PrestaShop Sync

Route `/app/prestashop/`. Docs pages: `web/content/{nb,en}/web-apps/prestashop/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://devdocs.prestashop-project.org/9/webservice/
- https://devdocs.prestashop-project.org/9/webservice/tutorials/advanced-use/additional-list-parameters/
- https://devdocs.prestashop-project.org/9/webservice/resources/orders/
- https://devdocs.prestashop-project.org/9/webservice/resources/customers/

- Mode: fix
- Calls: Same documented endpoints via fetchJson with sort=[id_DESC]; orders filtered with filter[valid]=[1] and display adds id_customer and valid; customers fetched with GET /api/customers?display=[id,firstname,lastname,company,email]&filter[id]=[a|b] and matched to ReAI by email or name. Before POST /api/orders it checks GET /api/orders?externalReference=prestashop-<id>. Exported fetchApi(fields, fetchImpl) for testing. Docs rewritten.
- Hosts in code: `devdocs.prestashop-project.org`, `shop.example.no`
- Vendor status: prestashop.com live; PrestaShop 9 webservice docs current at devdocs.prestashop-project.org.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/products`

## Caveats

Orders are still staged as one line with total_paid_tax_excl in NOK and ReAI's default VAT code; multi-currency shops and per-line VAT are not handled (docs tell the user to check VAT and currency). Product price is the PrestaShop base price excluding tax.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
