# TimeLog Hours to ReAI

Route `/app/timelog/`. Docs pages: `web/content/{nb,en}/web-apps/timelog/index.md`.

Purpose: fetch the token owner's TimeLog PSA time registrations for one month and post them one by one to ReAI
Timesheets, with the ReAI employee matched by email and projects matched by name.

## Vendor docs

- REST intro and TAF envelope: https://api.timelog.com/rest
- Auth (PAT): https://api.timelog.com/rest/personalaccesstokens and https://login.timelog.com/documentation
- Services: https://api.timelog.com/rest/services
- Methods used: https://api.timelog.com/rest/method/user_getcurrentuser,
  https://api.timelog.com/rest/method/timetrackingitem_getbydate
- Per-account Swagger (login required): `https://app[x].timelog.com/[account]/api/docs/ui/index`, see https://api.timelog.com/rest/swagger
- API policy: https://api.timelog.com/home/restrictions

## API version

REST API v1 (`/api/v1/...`), the only version the method pages publish. TimeLog guarantees a version for three years
from release; no newer version or sunset is announced.

## Auth

Personal access token created by the user at https://login.timelog.com/personaltoken while signed in (max two years),
sent as `Authorization: Bearer <PAT>`. The PAT has the permissions of that user, so the integration reads only that
user's registrations. The customer enters the account API URL `https://app[x].timelog.com/[account]` shown under
System Administration → Integrations and API → Transactional API settings; the host is checked against
`app[0-9]*.timelog.com`.

## Endpoints

- `GET {base}/api/v1/user/me` (Email, FirstName, LastName) for employee matching.
- `GET {base}/api/v1/time-tracking-item/get-by-date?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` (first and last day of the
  month). Fields used: TimeRegistrationID, Date, Hours, Minutes, AbsenceCodeID, ProjectName, TaskName, CustomerName,
  Comment, IsBillable. The method page documents a plain list; the REST intro says lists may come wrapped as TAFList
  (`Entities[].Properties`, `Properties.TotalPage`). Both are handled; extra pages are read with `$page` (cap 20).
- Absence registrations (AbsenceCodeID > 0) are left out. Hours = `Hours`, or `Minutes / 60` when Hours is 0.

## Subrequests per action

- Fetch: TimeLog 2 (+1 per extra TAF page) and ReAI 2 (`/api/employees`, `/api/projects?hierarchy=all` paged by
  `reaiAll`, usually 1 page).
- Post one row: ReAI 2 (`GET /api/timesheets` for the employee and day, `POST /api/timesheets`).
- No hard rate limit is documented ("may enforce rate limitations upon excessive usage").

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/employees`
- `GET /api/projects`
- `GET /api/timesheets`, `POST /api/timesheets` (employeeId, date, hours, projectId, comment)

## Mapping

One TimeLog registration becomes one ReAI timesheet row on its date, comment
`[TimeLog <TimeRegistrationID>] <project> · <task>: <comment>`. The marker is the duplicate check.

## Caveats

- Not verified against a live account. Whether `Hours` is decimal hours (assumed, documented type `number`) or the
  whole hour part next to `Minutes` is not stated; if live data shows the latter, change the hours formula.
- Only the token owner's hours; each employee runs it with their own PAT, or an admin can choose the ReAI employee.
- Projects are matched by exact name only; unmatched rows are posted without a project.

## Vendor contact

support@timelog.com (named for API access help on https://login.timelog.com/documentation).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
