# Handyman

Route `/app/handyman/`. Docs pages: `web/content/{nb,en}/web-apps/handyman/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://support.gsgroup.no/hc/en-us/articles/9651307325713
- https://hmapi.gsgroup.io:19000/swagger/docs/v1
- https://support.gsgroup.no/hc/en-us/articles/17674524711441
- https://support.gsgroup.no/hc/en-us/articles/17762953047953
- https://support.gsgroup.no/hc/en-us/articles/11054099455633
- https://support.gsgroup.no/hc/en-us/articles/14603270801681

- Mode: fix
- Calls: Customer's own Handyman API server URL (public https, SSRF guarded); headers apiKey + HandymanClientId; GET /api/orders?status=2&lastChanged&pageSize=100&startIndex paged, filtered by OrderHead.ActualFinishDate/FinishDate in period, excluding ExcludeFromInvoice/IsInternalOrder (max 40 orders); per order GET /api/orders/{id}/salarycoderegistrations (hours = Amount where Unit 0, not Rejected; labour = Amount*CustomerPrice) and /materials (Quantity*CustomerPrice); OrderHead.FixedPrice overrides; GET /api/customers/{id} for CustomerName. ReAI side unchanged and verified: POST /api/orders (customerId, currencyCode, daysUntilDue, issueDate, orderLines), POST /api/timesheets. CSV removed.
- Hosts in code: `hmapi.example.no`, `hmapi.gsgroup.io`, `support.gsgroup.no`
- Vendor status: Brreg: GSG HANDYMAN AS active; handyman.onegsgroup.com live with ERP integrations; support.gsgroup.no documents the Handyman REST API (Swagger at hmapi.gsgroup.io:19000).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/employees`
- `/api/orders`
- `/api/projects`
- `/api/timesheets`

## Caveats

API is self-hosted per customer; it must be published over https by the customer's IT partner, otherwise the Worker cannot reach it. Header names come from the Swagger UI config (apiKeyName 'apiKey', in header) and the HandymanClientId header parameter. Swagger has no descriptions for CustomerPrice; treated as unit price (preview must be checked). An order with more than 24 hours cannot be logged as one timesheet entry. Shared Trades test (expects x-api-key and {items:[{orderNumber...}]}) will fail.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
