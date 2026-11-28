# Finago Busy

Route `/app/busy/`. Docs pages: `web/content/{nb,en}/web-apps/busy/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api.busy.no/
- https://api.busy.no/v2/openapi.json

- Mode: rename
- Calls: Branded 'Finago Busy'. Bearer token; GET /v2/users/ (users:read) for names and optional email filter, GET /v2/hourEntries/ (startTimeFrom, startTimeTo, userIdIn, orderBy=startTime, limit=100/offset paging), hours=(totalMinutes-breakDeductionMinutes)/60, optional approvalStatus=approved filter, dates in Europe/Oslo; GET /v2/projects/{id} for number+name. Posts POST /api/timesheets. CSV removed; employee/project selects on the API form.
- Hosts in code: `api.busy.no`
- Vendor status: busy.no redirects to 24sevenoffice.com/no/produkter/timeregistrering; api.busy.no serves the 'Finago Busy Public API' v2.1.0 Redoc; Brreg: 24SEVENOFFICE NORWAY AS active.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Token needs scopes hourEntries:read, users:read, projects:read (or 'all'). Exact UI label for the token page is 'workspace settings under integrations' per the API docs. Shared test 'HR, WFM...' block for busy mocks the old shape and will fail. Brand rename may need apps.json/catalog title update by the coordinator.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
