# PayPal Reconcile

Route `/app/paypal/`. Docs pages: `web/content/{nb,en}/web-apps/paypal/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.paypal.com/api/rest/authentication/
- https://developer.paypal.com/docs/api/transaction-search/v1/
- https://developer.paypal.com/docs/transaction-search/transaction-event-codes/

- Mode: fix
- Calls: Exported fetchApi(fields, start, end, fetchImpl): POST /v1/oauth2/token client_credentials, then GET /v1/reporting/transactions with start_date/end_date (RFC 3339, one month, under the 31 day cap), fields=transaction_info, page_size=500, page 1..total_pages. Keeps only T04xx bank withdrawals except T0402 (Hyperwallet), negative amounts with status S; reads transaction_id, transaction_initiation_date, transaction_amount, fee_amount, bank_reference_id. Dintero card removed. Docs NB/EN rewritten (Apps & Credentials → Live app → Transaction search).
- Hosts in code: `api-m.paypal.com`, `developer.paypal.com`, `uri.paypal.com`
- Vendor status: PayPal Business and the Transaction Search API are live; developer.paypal.com schema.json served 2026-11-28.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

Foreign entity, not in Brønnøysund. PayPal notes Transaction Search data can lag up to three hours. Not covered by web/test/provider-api.test.mjs.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
