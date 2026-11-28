# Planday

Route `/app/planday/`. Docs pages: `web/content/{nb,en}/web-apps/planday/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://openapi.planday.com/gettingstarted/authorization/
- https://openapi.planday.com/api/schedule
- https://openapi.planday.com/scheduling/swagger/v1.0/swagger.json
- https://openapi.planday.com/hr/swagger/v1.0/swagger.json

- Mode: fix
- Calls: Refresh token flow: POST https://id.planday.com/connect/token (client_id, grant_type=refresh_token, refresh_token), then Authorization: Bearer + X-ClientId on GET /hr/v1.0/departments (names) and GET /scheduling/v1.0/shifts?from&to&employeeId&shiftStatus=Approved&limit&offset (paging.total). Hours = endDateTime - startDateTime - unpaid manualBreaks. ReAI employee/project selectors moved into the API form so rows can be posted to POST /api/timesheets. CSV upload removed (customer admins create the API app themselves).
- Hosts in code: `id.planday.com`, `openapi.planday.com`
- Vendor status: planday.com live; Planday Open API docs and swagger specs served at openapi.planday.com (scheduling v1.0/v2.0 not deprecated).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Imports one Planday employee per fetch (employeeId filter) because ReAI timesheets are per employee. Shift times are treated as local wall-clock values as returned. web/test/provider-api.test.mjs still calls the old fetchApi signature for this slug; update or drop that case.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
