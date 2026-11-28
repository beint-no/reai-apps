# Finago Busy Timesheet Sync

Route `/app/busy/`. Docs pages: `web/content/{nb,en}/web-apps/busy/index.md`.
Fetches Finago Busy hour entries for a period and posts them to ReAI Timesheets, one row per click.

## Vendor docs

- Reference (Redoc, includes auth, pagination, rate limit and deprecation notices): https://api.busy.no/
- OpenAPI: https://api.busy.no/v2/openapi.json ("Finago Busy Public API" 2.1.0 on 2026-11-28)
- Demo workspace with token for testing: https://demo.busy.no/demo/api (base `https://api.demo.busy.no/v2`)
- Changelog: none published; deprecations are listed in the reference introduction (only fixed price projects, not used here).

## API version

REST `v2` (`https://api.busy.no/v2`), the current public API. No newer version or sunset is announced.

## Auth

`Authorization: Bearer <token>`. An admin creates the token in the workspace settings under Integrations, with scopes
`hourEntries:read`, `users:read`, `projects:read` (avoid `all`). Tokens last at most one year.

## Endpoints used

- `GET /v2/users/?isActive=all` (limit 100, offset): id, email, displayName. Used for names, the optional email filter and employee matching.
- `GET /v2/hourEntries/` with `startTimeFrom`/`startTimeTo` (inclusive datetimes, sent as Europe/Oslo day bounds in UTC),
  optional `userIdIn`, `orderBy=createdAt` (stable while paging), `limit=100` (documented maximum), `offset`.
  Fields: id, userId, projectId, totalMinutes, breakDeductionMinutes, description, approvalStatus, startTime, stopTime, isActive.
- Project names: `GET /v2/projects/{id}` in parallel when at most 10 distinct projects, else `GET /v2/projects/?isActive=all` (at most 10 pages).

## Budget

Users and hour entries are read in parallel (sequential when filtering by email): 1 users page + up to 30 entry pages
(3,000 entries, then a "choose a shorter period" error) + up to 10 project calls. A typical month uses 3 to 8 subrequests.
Rate limits are dynamic; `429` shows the `Retry-After` (or `RateLimit-Reset`) wait to the user.

## ReAI API

- `GET /api/employees` (form selects and email matching), `GET /api/projects` (form select).
- `GET /api/timesheets?employeeId&startDate&endDate` duplicate check on the `[Busy #<id>]` comment prefix.
- `POST /api/timesheets` (employeeId, date, hours 0.01 to 24, projectId, comment).

## Mapping

Hours = (totalMinutes − breakDeductionMinutes) / 60, rounded to 2 decimals; date = startTime in Europe/Oslo. Deleted
(`isActive: false`) and running (no stopTime) entries are skipped; "only approved" keeps `approvalStatus: approved`.
Each row goes to the ReAI employee whose email matches the Busy user; the selected employee is used only when every row
belongs to one Busy user. Comment `[Busy #<entry id>] <description>`.

## Caveats

- No server-side approval filter exists; approval is filtered locally.
- One ReAI project applies to all rows; Busy projects are shown for reference only.

## Rules

- Use only documented endpoints, auth, parameters and fields on the newest API version, with server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
