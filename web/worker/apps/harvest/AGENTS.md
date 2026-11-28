# Harvest Sync

Route `/app/harvest/`. Docs pages: `web/content/{nb,en}/web-apps/harvest/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/
- https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/

- Mode: fix
- Calls: GET https://api.harvestapp.com/v2/time_entries with from, to (inclusive last day), is_running=false, optional user_id, page/per_page=2000 following next_page; Bearer + Harvest-Account-Id + User-Agent; project and user name shown; entries outside 0.01 to 24 h skipped. Exported fetchApi for testing; optional user ID field added.
- Hosts in code: `api.harvestapp.com`, `help.getharvest.com`
- Vendor status: help.getharvest.com API v2 docs live and current; product sold.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
