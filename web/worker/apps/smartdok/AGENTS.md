# SmartDok Hours Sync

Route `/app/smartdok/`. Docs pages: `web/content/{nb,en}/web-apps/smartdok/index.md`.

Purpose: fetch attested SmartDok work hours for a period and post them one by one to ReAI Timesheets for a chosen
employee and optional project.

## Vendor docs

- Reference: https://api.smartdok.no/api-docs/ (OpenAPI 3: https://api.smartdok.no/docs/v1)
- Auth: same page, "How to use API" section and `POST /Authorize/ApiToken`
- Changelog: none published; the spec `info.version` is `v1`

## API version

SmartDok API `v1`, the only published version. `GET /WorkHours/v2` exists and is paged, but returns only ids and clock
times (`TimeFrom`, `TimeTo`, `ProjectId`, `WageId`), so it would need extra lookups for project names, wage names and
net hours. `GET /WorkHours` (v1) is not deprecated and returns all of that in one response.

## Auth

An administrator generates an API access token in SmartDok under Company settings → API administration (needs API
access on the plan; valid one year). The worker posts `{ "Token": "<token>" }` to `POST /Authorize/ApiToken`, which
returns the session token as a bare JSON string, then sends `Authorization: Bearer <session>`.

## Endpoints

- `POST https://api.smartdok.no/Authorize/ApiToken`
- `GET /Users?all=true` (Items: `Id`, `Name`, `EmployeeNo`) for names
- `GET /WorkHours?fromDate&toDate&onlyAttested=true&includeExported=true&absence=false`. `toDate` is sent as
  `YYYY-MM-DDT23:59:59` so the last day is included; at most 93 days. Items: `WorkHourID`, `UserID`, `EmployeeNo`,
  `Date`, `NetHours`, `OrdinaryHours`, `WageName`, `WageAddition`, `UnitAddition`, `Diet`, `MachineHourId`,
  `ProjectNumber`, `ProjectName`, `SubProjectName`, `Comment`.

Paging: `/WorkHours` v1 has no paging parameters and returns the whole period. Rate limits are not documented.
Subrequests per fetch: 3 (token, then `/Users` and `/WorkHours` in parallel). Per import: 2 ReAI calls.

## ReAI endpoints

- Page load: `GET /api/employees`, `GET /api/projects?archived=false` (paged)
- Import: `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check), `POST /api/timesheets`

## Mapping

Wage additions, unit additions, allowances (`Diet`) and machine rows are skipped; absence is filtered server side.
Hours = `NetHours`, falling back to `OrdinaryHours`; rows outside 0.01 to 24 h are dropped. Comment =
`[SmartDok #<WorkHourID>] <ProjectNumber ProjectName · SubProjectName> · <WageName> · <Comment>`. An existing ReAI
timesheet for the same employee and day whose comment starts with that tag blocks a second post. Optional employee
filter matches name (contains) or employee number (exact), applied locally because `/WorkHours` has no user filter.

## Caveats

- `NetHours` versus `OrdinaryHours` semantics are only named in the spec; `NetHours` is used when present.
- Whether `toDate` is inclusive is not documented; the end of day time covers both readings.
- web/test/provider-api.test.mjs no longer exercises this slug.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
