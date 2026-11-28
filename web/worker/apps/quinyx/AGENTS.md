# Quinyx

Route `/app/quinyx/`. Docs pages: `web/content/{nb,en}/web-apps/quinyx/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.quinyx.com/api/v3/specs/quinyx-public-api-v3
- https://developer.quinyx.com/_bundle/api/v3/specs/quinyx-public-api-v3.yaml
- https://quinyx.helpdocs.io/l/en/article/msqoict4gl-integration-credentials-intro

- Mode: fix
- Calls: POST https://api.{eu|na}.quinyx.com/oauth/v3/token (client_credentials, scope schedule:shifts:read), then GET /schedule/v3/shifts?employeeIdIn=badgeNumber:<n>&beginGte&beginLte&deleted=false&pageSize=100 with pageToken pagination and Prefer: timezone=Europe/Oslo. Hours = end - begin - breaks; freeDay, deleted and countWorkedHours=false shifts skipped. ReAI employee/project selectors in the API form, rows posted to POST /api/timesheets. CSV removed (account managers create credentials themselves).
- Hosts in code: `developer.quinyx.com`, `quinyx.helpdocs.io`
- Vendor status: quinyx.com live; developer.quinyx.com publishes the v3 public API (general availability for shifts).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

The v3 API exposes scheduled shifts, not attested punches, so the page and docs say the hours are planned shifts to check against punches. Shift status values are not enumerated in the spec, so no status filter is applied. web/test/provider-api.test.mjs still calls the old fetchApi signature for this slug; update or drop that case.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
