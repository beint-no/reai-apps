# Tamigo

Route `/app/tamigo/`. Docs pages: `web/content/{nb,en}/web-apps/tamigo/index.md`.

Fetches worked shifts from the Tamigo timesheet and posts them one by one to ReAI Timesheets for one chosen
ReAI employee and project.

## Vendor docs

Tamigo publishes its API as PDFs attached to help centre articles:

- Reference ("API Dok. pr. 01.04.2024 - full versjon", Application Services PDF, section Attendance Services
  c) Get Check-in/Check-out Overview):
  https://tamigono.freshdesk.com/support/solutions/articles/5000867116-api-dok-pr-01-04-2024-full-versjon
- Auth (Application Services, Introduction and Application Login):
  https://tamigono.freshdesk.com/support/solutions/articles/5000793304-application-services-
- Changelog: no changelog; the API folder lists dated articles (newest: Departments endpoint 2025-11-28,
  Driftskonto 2026-02-27, neither changes the endpoints used):
  https://tamigono.freshdesk.com/support/solutions/folders/5000296483

## API version

Unversioned REST on `https://api.tamigo.com`; the 01.04.2024 document calls itself the latest at all times.
No sunset announced.

## Auth

Administrator creates an application key under Configuration → Web Services (API). The customer enters the
application name and key. `POST /login/application` with `{ Name, Key }` returns `SessionToken`, sent as
header `x-tamigo-token`. One login per fetch. Never stored.

## Endpoints

`GET /attendance/CheckInOutOverview/?startDate=yyyy-MM-dd&endDate=yyyy-MM-dd&departmentId=all`. Returns
a plain array, no paging. Fields used: `Date` (`/Date(ms+zzzz)/`, read as the local calendar date),
`ActualShiftHours`, `EmployeeName`, `WageSystemKey`, `DepartmentName`, `ActualShiftText`,
`ActualShiftComment`. Employee filter (name substring or `WageSystemKey`) is applied locally because the
endpoint has no employee parameter.

## Budget

- Fetch: 2 subrequests (login + overview). Range guard 93 days (docs state no maximum).
- Post one shift: `GET /api/timesheets?employeeId&startDate&endDate` (same day) + `POST /api/timesheets`. 2.
- Page load: `GET /api/employees` + `GET /api/projects?archived=false` (1 per 200 projects).
- No rate limit documented; no retry logic.

## ReAI endpoints

`GET /api/employees`, `GET /api/projects`, `GET /api/timesheets`, `POST /api/timesheets`.

## Mapping

- One timesheet entry per shift: date, `ActualShiftHours` rounded to 2 decimals (0.01 to 24), comment
  `[Tamigo] <department> · <shift text> · <comment>`, chosen project.
- Rows from several Tamigo employees cannot be posted (all would land on one ReAI employee); the customer
  must filter to one employee.
- Duplicate check: an entry for the same employee, date, hours and comment is reported as already logged.

## Caveats

- Not tested against a live tenant. `ActualShiftHours` is assumed to exclude breaks, as in the Timesheet.
- Shifts with zero actual hours (planned only) are skipped.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
