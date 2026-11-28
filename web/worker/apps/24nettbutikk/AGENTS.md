# 24Nettbutikk Sync

Route `/app/24nettbutikk/`. Docs pages: `web/content/{nb,en}/web-apps/24nettbutikk/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://github.com/SincosSoftware/webshop_api/wiki/API-Documentation
- https://github.com/SincosSoftware/webshop_api/wiki/orders
- https://github.com/SincosSoftware/webshop_api/wiki/products
- https://github.com/SincosSoftware/webshop_api/wiki/customers
- https://support.24nettbutikk.no/knowledge/slik-genererer-du-api-n%C3%B8kler
- https://docs.ongoingwarehouse.com/integrations/24nettbutikk

- Mode: fix
- Calls: GET {shop}/api/v1/products/100/{offset}, GET {shop}/api/v1/orders/100/{offset}/{since} (since = month start, filtered to paid, not deleted/cancelled/rejected orders with order_date in the month), GET {shop}/api/v1/customers/{customer_id} for name, organisation_no and e_mail. ReAI: GET /api/products, GET /api/customers (match on organizationNumber or email/invoiceEmail), GET /api/vat-codes?usage=customer_invoice, POST /api/products with vatCode per product VAT %, POST /api/orders with one line per shop line (net = total_amount_gross - total_vat, vatCode from the line VAT %), a residual shipping/charges line at the order VAT %, externalReference 24nettbutikk-<order_no> (ReAI returns 409 on duplicates). Gift card orders are left for manual booking.
- Hosts in code: `github.com`, `minbutikk.no`, `support.24nettbutikk.no`
- Vendor status: Brreg: Sincos Software AS active (no konkurs/avvikling, last accounts 2025), homepage 24nettbutikk.no; 24nettbutikk.no live and sold, new 24Next platform launched autumn 2025 with API keys in its help centre.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/products`
- `/api/vat-codes`

## Caveats

The vendor's API reference is its own GitHub wiki (last edited 2021). The 24Next help article explains generating API keys (click your name, API Nøkler, Generer tilfeldig kode) but does not restate the endpoint list, so it is not confirmed that 24Next keys use the same /api/v1 Basic auth; the legacy wiki says the token sits in admin under /admin/index.php?nr=103. The product resource does not say whether price includes VAT, so the UI copies it as stored and warns the user. Customer lookups are capped at 40 per scan.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
