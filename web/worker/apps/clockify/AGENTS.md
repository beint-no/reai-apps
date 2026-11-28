# Clockify Sync

Route `/app/clockify/`. Docs pages: `web/content/{nb,en}/web-apps/clockify/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.clockify.me/
- https://clockify.me/help/troubleshooting/api-key-and-authentication/where-to-generate-api-key-for-account

- Mode: fix
- Calls: X-Api-Key; GET {region host}/api/v1/user, GET /v1/workspaces/{ws}/user/{userId}/time-entries with start/end, page, page-size=200 (paged), skip entries without timeInterval.end, hours from start/end (ISO duration fallback), date in Europe/Oslo; GET /v1/workspaces/{ws}/projects (paged) for names. Region select: global, euc1, use2, euw2, apse2. Exported fetchApi for testing. Docs rewritten with Preferences → Advanced → Manage API keys.
- Hosts in code: `api.clockify.me`, `apse2.clockify.me`, `docs.clockify.me`, `euc1.clockify.me`, `euw2.clockify.me`, `use2.clockify.me`
- Vendor status: clockify.me and docs.clockify.me live; API v1 documented and current.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Reads only the API key owner's entries in the active workspace (as before). Free plan keys are limited to 30 requests per hour per workspace.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
