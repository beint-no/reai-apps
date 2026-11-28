# Quinyx Shift & Hours Sync

Route `/app/quinyx/`. Docs pages: `web/content/{nb,en}/web-apps/quinyx/index.md`.

Reads the scheduled shifts of one Quinyx employee for a period and posts each shift's hours to ReAI Timesheets on click.

## Vendor API

- Reference: https://developer.quinyx.com/api/v3/specs/quinyx-public-api-v3
- OpenAPI bundle: https://developer.quinyx.com/_bundle/api/v3/specs/quinyx-public-api-v3.yaml
- Credentials: https://quinyx.helpdocs.io/l/en/article/msqoict4gl-integration-credentials-intro
- Changelog: none published; release phase is given per operation (`x-release-phase`).

API version: Public API v3 (`info.version` v3). `/oauth/v3/token` and `/schedule/v3/shifts` are `general-availability`; the v1/v2 SOAP APIs are older.

Auth: an account manager creates integration credentials in Quinyx under Account settings → Access rights → Integration credentials with read access to Shifts. `POST https://api.{eu|na}.quinyx.com/oauth/v3/token` (form, `grant_type=client_credentials`, `scope=schedule:shifts:read`) returns `access_token`, sent as `Authorization: Bearer`. One token per fetch.

Endpoint: `GET /schedule/v3/shifts?employeeIdIn=badgeNumber:<n>&beginGte&beginLte&deleted=false&pageSize=100&pageToken=` with `Prefer: timezone=Europe/Oslo`. Fields: `id, groupId, begin, end, breaks[].begin/end, freeDay, deleted, countWorkedHours, comment`.

Paging and budget: cursor paging via `pagination.nextPageToken`, `pageSize` maximum 100, at most 50 pages. Fetch action: 1 token request plus 1 request per 100 shifts (normally 2 in total). Import click: 2 ReAI requests (duplicate check, create). Page load: 2+ ReAI requests (employees, projects). Quinyx answers `429` problem details when rate limited; no limit value is published.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees`, `GET /api/projects` (selectors)
- `GET /api/timesheets?startDate=&endDate=&employeeId=` (duplicate check)
- `POST /api/timesheets` (`employeeId, date, hours, projectId?, comment`)

## Mapping

Hours = end minus begin minus breaks, two decimals, 0.01 to 24. Free days, deleted shifts and `countWorkedHours=false` are skipped. Filters are UTC (Prefer only changes response times), so `beginGte` starts at 22:00Z the day before and each shift is dated by its Oslo start day, then filtered to the period. The timesheet comment starts with `[Quinyx shift <id>]`; an existing timesheet for the same employee and day with that prefix blocks a second post.

## Caveats

- v3 exposes scheduled shifts, not punches; the docs page says to check them against punches.
- Shift `status` values are not enumerated in the spec, so no status filter is applied.
- Dating relies on Quinyx honouring `Prefer: timezone=Europe/Oslo`; without it, shifts starting between 00:00 and 02:00 Oslo time would land on the previous day.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
