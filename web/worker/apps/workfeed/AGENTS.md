# Workfeed Shift Hours

Route `/app/workfeed/`. Docs pages: `web/content/{nb,en}/web-apps/workfeed/index.md`.

Reads Workfeed shifts for a period and posts the hours to ReAI Timesheets per employee (basis for
payroll and project billing; not postings).

## Vendor docs

- Reference (Postman, current, examples dated 2026): https://docs.workfeed.io/
- Key setup: https://help.workfeed.io/en/articles/15956343-how-to-get-access-to-our-api (nb: https://help.workfeed.io/nb/articles/15956343)
- Changelog: none published.

## API version

Single unversioned API at `https://europe-west1-production-eu-327a3.cloudfunctions.net/api/companies/{companyID}/...`.

## Auth

Pro+ plan: Settings > Integrations > Workfeed API creates a key. Header `Authorization: <API key>`
(no Bearer). Keys are read/write; the app only GETs. The customer enters the company ID (docs do
not say where it is shown).

## Endpoints used

- `GET /shifts?startFrom&startTo` (required; filter on shift start). Queried one UTC day wider
  and filtered on the Europe/Oslo day of `start`. No paging documented; rows capped at 1000.
- `GET /employees` (name, email), `GET /departments` (name).

## Budget per action

- Fetch: 3 Workfeed calls + 1 ReAI employees call, all in parallel.
- Single post: 1 ReAI duplicate read + 1 POST.
- Bulk post: 1 ReAI duplicate read for the whole period + up to 40 POSTs (4 in flight); the
  response offers a button for the next 40, so each invocation stays at 41 subrequests or less.
- No rate limits documented.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/projects`, `GET /api/employees`
- `GET /api/timesheets?startDate&endDate[&employeeId]` (duplicate check)
- `POST /api/timesheets` (`employeeId`, `date`, `hours` 0.01 to 24 with two decimals, optional
  `projectId`, `comment`)

## Mapping

Hours = `end - start - customBreak.duration` (hours). `approval.originalStart/originalEnd` hold
the planned times, so `start/end` are the worked times. "Approved only" (default) keeps shifts
with `approval != null`. Employees matched to ReAI by email, then name. Comment
`[Workfeed] <department> · shift <id>`; that shift id is the duplicate key.

## Caveats

- Duplicate check assumes `GET /api/timesheets` without `employeeId` lists all employees the
  user can see; single posts pass `employeeId`.
- `/employees` also returns SSN and bank fields; only name and email are read.
- Partner contact: https://workfeed.io/integration-partners/

Last verified: 2026-11-28
