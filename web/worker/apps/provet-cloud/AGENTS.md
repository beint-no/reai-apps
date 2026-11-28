# Provet Cloud Veterinary Sales Accounting

Route `/app/provet-cloud/`. Docs pages: `web/content/{nb,en}/web-apps/provet-cloud/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.provetcloud.com/restapi/
- https://developers.provetcloud.com/restapi/authentication_oauth2.html
- https://developers.provetcloud.com/restapi/howto_billing.html
- https://developers.provetcloud.com/restapi/howto_erp_accounting.html
- https://developers.provetcloud.com/restapi/pagination.html
- https://developers.provetcloud.com/restapi/0.1/
- https://developers.provetcloud.com/restapi/0.1/openapi-schema-01.json

- Mode: api
- Auth: Clinic requests REST API access via Provet's 'Request Sandbox and API access' form (explicitly offered to Provet customers building their own integration); Provet support configures a client credentials integration and issues client ID + secret. App POSTs https://provetcloud.com/<provet_id>/oauth2/token/ (grant_type=client_credentials, scope=restapi, HTTP Basic client auth) and sends Authorization: Bearer <access_token>. Virtual user needs Financial: Invoices.
- Hosts in code: `developers.provetcloud.com`, `provetcloud.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Nordhealth Norway AS). provet.cloud live ('Provet | Veterinary Practice Management Software'); Nordhealth lists Provet as its product; App Store app Provet Cloud by Nordhealth Finland Oy.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Credentials are not self-service: Provet must configure the client. Host restricted to *.provetcloud.com (OpenAPI server variable 'domain', default provetcloud.com). Uses GET /invoice/ (invoice_date__gte/__lt, page_size=200, follows next), /invoicerow/?invoice__in= (vat_percentage, sum_total) and /invoicepayment/?invoice__in= (payment_type, paid). Excludes status 0 (draft) and 99 (voided) and invoices without invoice_number; statuses 1-4 counted as issued. The guide uses status__is but the OpenAPI lists _status__is, so status is filtered client side. Payment types 0/7 -> 1580, 1 -> 1900, 3 -> 7790, 5/8/9 -> 2900, remainder of invoice totals -> 1570. 0% rows -> 3200 VAT code 6. Invoice has no currency field; assumes NOK clinic. Rate limit 60/min on /invoice/.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
