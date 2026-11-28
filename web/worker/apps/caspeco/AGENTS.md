# Caspeco Daily Sales Accounting

Route `/app/caspeco/`. Docs pages: `web/content/{nb,en}/web-apps/caspeco/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.caspeco.se/v1/guides/sales-export-api/overview/
- https://developers.caspeco.se/v1/guides/sales-export-api/data-specification/
- https://developers.caspeco.se/v1/api/analytics/operations/exportapi_sales/
- https://developers.caspeco.se/

- Mode: api
- Auth: Classic Sales Export API: Caspeco support issues an AuthKey and the customer's system name (overview: token 'provided to you by Caspeco or through the shared customer'). Sent as AuthKey header to GET https://salesapi.caspeco.net/api/sales/{system}/{YYYY-MM-DD}; 100 requests per day per token.
- Hosts in code: `developers.caspeco.se`, `salesapi.caspeco.net`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Caspeco Norge AS). caspeco.com live, sells POS, staff, booking and analytics.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

The current Caspeco API (OAuth client credentials at id.caspeco.se, Analytics sales v2 with ReceiptPayments amounts) is partner-only: Caspeco reviews a partner application and creates the integration, so it was not used. The classic Export API response schema is only '{}' in the reference; field names (SalesExVat, SalesVat, Payment, TicketTip, RecieptId) come from the data specification and are read case-insensitively. VAT rate is derived from SalesVat/SalesExVat (snapped to 25/15/12/0). Payment is 'an internal Caspeco representation' with no amount, so sales are grouped by each line's payment type (split-tender receipts are approximated); not documented whether SalesExVat is after discount or whether returns are negative. Payment labels starting with 'cash'/'kontant' go to 1900. No live verification. Caspeco also owns Trivec.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
