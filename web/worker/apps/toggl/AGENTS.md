# Toggl Track Sync

Route `/app/toggl/`. Docs pages: `web/content/{nb,en}/web-apps/toggl/index.md`.

Reads the token owner's Toggl Track time entries for one month and posts chosen entries to ReAI
Timesheets for a selected employee and optional project.

## Vendor docs

- Reference: https://engineering.toggl.com/docs/track/api/time_entries/
- Auth: https://engineering.toggl.com/docs/track/authentication/
- Format, quota, rate limits: https://engineering.toggl.com/docs/track/
- Changelog: https://engineering.toggl.com/changes/ (v8 removed 2022; no v9 sunset announced)

## API

- Version: Track API v9 (`https://api.track.toggl.com/api/v9`), the current and only supported version.
- Key: Toggl Track → Profile settings → API Token. Header `Authorization: Basic base64(<token>:api_token)`.
- `GET /me/time_entries?start_date&end_date&meta=true`. Dates are sent as RFC 3339 UTC instants for
  Oslo midnight of the first day and of the day after the month, so the range follows Europe/Oslo days.
  `meta=true` adds `project_name`. Entries are then bucketed by their `start` converted to Europe/Oslo and
  kept only inside the month.
- Running entries (negative `duration`) and entries with `server_deleted_at` are skipped. Hours are
  `duration / 3600` rounded to 0.01 and clamped to 0.01–24.
- Paging: none documented; the endpoint returns the whole range in one array.
- Limits: `/me` endpoints have a quota of 30 requests per hour per user (HTTP 402 with
  `X-Toggl-Quota-Resets-In`) and a leaky bucket of about 1 request per second (HTTP 429). Both are
  reported to the user; no automatic retry.

## Subrequests per action

- Page load: 2 (ReAI employees, projects; more only if over 200 projects).
- Preview: 1 (Toggl).
- Post one row: 2 (ReAI timesheets lookup for that day, then create).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees`, `GET /api/projects` (non-archived)
- `GET /api/timesheets?employeeId&startDate&endDate` for the duplicate check (same day, hours, comment and project)
- `POST /api/timesheets` with `employeeId`, `date`, `hours`, optional `projectId`, `comment` (`[Toggl Track] <description>`)

## Caveats

- Only the token owner's own entries are read; workspace-wide reports need the Reports API and are out of scope.
- One ReAI entry is created per Toggl entry; several entries on one day become several ReAI rows.
- Toggl's project is shown for reference only; the ReAI project is chosen in the form.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
