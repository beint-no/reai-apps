# RecMan Accounting Bridge

Route `/app/recman/`. Docs pages: `web/content/{nb,en}/web-apps/recman/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://help.recman.io/hc/en-us/articles/11866067675154-API-in-RecMan
- https://help.recman.io/hc/en-us/articles/38572087044370-Economy-Retrieving-Invoices-Credit-Notes-PDFs-Attachments-and-Managing-Export-Logs-via-the-API
- https://help.recman.io/hc/en-us/articles/38573936360210-Economy-Retrieving-Active-and-Deleted-Paychecks-and-Managing-Paycheck-Export-Logs
- https://help.recman.io/hc/article_attachments/40964162069138

- Mode: fix
- Calls: recman-core.js parseRecManCandidates now keeps employment start/end dates only when they are YYYY-MM-DD (so 'ongoing' becomes empty and no end date is sent). Docs cleaned (no em dashes) and the key path corrected to System settings → Database → API → Create (system administrator). Everything else unchanged.
- Hosts in code: `api.kartverket.no`, `api.recman.io`
- Vendor status: Brreg: active, no konkurs/avvikling; recman.no live; RecMan API v2 help center articles updated and Postman collection published.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/chart-of-accounts/accounts`
- `/api/customers`
- `/api/employees`
- `/api/employees/{id}`
- `/api/invoices`
- `/api/invoices/import`
- `/api/orders`
- `/api/salary-payments`
- `/api/salary-payments/{id}`
- `/api/salary-payments/{id}/wage-specs`
- `/api/salary-settings`
- `/api/vat-codes`

## Caveats

Edited web/worker/apps/recman-core.js (recman's own helper, not shared). ReAI paths used (/api/invoices/import, /api/salary-payments, /api/employees/{id}, /api/orders, /api/customers, /api/vat-codes, /api/chart-of-accounts/accounts, /api/salary-settings) all exist in the contract; I spot-checked the invoices/import body fields but did not re-verify every payroll body field. RecMan bills lookups beyond 200 per day.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
