# Kvalitetskontroll Hours Sync

Route `/app/kvalitetskontroll/`. Docs pages: `web/content/{nb,en}/web-apps/kvalitetskontroll/index.md`.

Fetches approved hour registrations from Kvalitetskontroll (KS) and logs chosen rows as ReAI
timesheet rows. Nothing is booked to the ledger.

## Vendor API

- Reference (Scribe): https://api.kvalitetskontroll.no/docs/
- OpenAPI 3.0.3 (`info.version` 1.0.0): https://api.kvalitetskontroll.no/docs/openapi.yaml
- Postman: https://api.kvalitetskontroll.no/docs/collection.json
- No changelog is published. The only versioned resource is `/v2/employees`; the plain `/employees`
  list is still documented and is used because it returns `name` directly.

Auth: the customer logs in at https://api.kvalitetskontroll.no/admin with their KS user and adds a
Personal Access Token. Sent as `Authorization: Bearer <token>`; the token scopes the company. An
invalid token gets a `302` to the JWKS page, mapped to a clear error.

Vendor status: product and site live under the SmartCraft group (Kvalitetskontroll AS 991557415 was
deleted 2024-12-16; SmartCraft Norway AS 927150182 active).

## Endpoints

- `GET /timetracking/registrations?from_date=<from>T00:00:00&to_date=<to>T23:59:59&is_approved=1&offset&limit=100`
- `GET /employees?offset&limit=100` (`id`, `name`)
- `GET /projects?offset&limit=100` (`id`, `project_no`, `name`), only when a registration has a project
- `GET /timetracking/hourtypes?offset&limit=100` (`id`, `title`)

Scribe documents the filters as a JSON body on GET; its own curl example sends them with `--get`, so
query parameters are used. Registrations: `registration_date` is UTC midnight of the Oslo day and is
converted to Europe/Oslo; rows outside the period, deleted or unapproved rows are dropped. `duration`
is minutes after break, converted to hours with two decimals.

## Paging, limits, budget

The maximum `limit` is undocumented, so the offset advances by rows received and paging stops on an
empty page or a page with no new ids (at most 50 pages). Docs show `x-ratelimit-limit: 600` per token;
`429` gives a retry message. Fetch: registrations pages + 1, employees 2, projects 2, hour types 2
(about 9 for a month with 100 to 200 rows), plus ReAI employees 1 and projects 1. Log hours: 2.

## ReAI API

- `GET /api/employees`, `GET /api/projects?archived=false&hierarchy=all&page&pageSize=200` (mapping).
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check on the `[Kvalitetskontroll KS-<id>]`
  comment prefix), then `POST /api/timesheets` (`employeeId`, `date`, `hours`, `projectId`, `comment`).

## Mapping

Employee by exact name, else the chosen fallback. Project by exact name ("project_no name" or name),
else the chosen fallback project or none. Comment: `[Kvalitetskontroll KS-<id>] <hour type>: <comment>`.

## Caveats

- Hours only: KS documents no price on registrations, so no orders are staged.
- The list response envelope is undocumented; a bare array or `{ data: [] }` is accepted.
- Which KS role may create a token is undocumented.

Last verified: 2026-11-28.
