# Timely Timesheet Sync

Route `/app/timely/`. Docs pages: `web/content/{nb,en}/web-apps/timely/index.md`.

Fetches logged Timely hours for a period with the customer's own Timely OAuth app and posts them to ReAI Timesheets,
matched by employee email or name and project name.

## Vendor docs

- Reference (OpenAPI 3.1 embedded in the page, Scalar): https://developer.timely.com/
- Auth setup: https://www.timely.com/help/handbook/tips-tricks/getting-started-with-timelys-api/
- Changelog: none published. API help: support@timely.com.

## API version and auth

- API 1.1 (`https://api.timelyapp.com/1.1/...`), the only version; spec info version "V1", examples dated 2026-11.
- OAuth 2.0 authorization code. The admin creates an app in Settings → Devs
  (`https://app.timelyapp.com/{account_id}/oauth_applications`) with redirect URI `https://apps.reai.no/app/timely/`.
  The app returns a link to `GET /1.1/oauth/authorize?response_type=code&client_id&redirect_uri&state=<account id>`
  (a link, because CSP `form-action 'self'` blocks a form redirect). `POST /1.1/oauth/token` with JSON `grant_type`,
  `client_id`, `client_secret`, `code`, `redirect_uri`; then `Authorization: Bearer <access_token>`. A pasted access
  token skips the exchange. Codes are single use; nothing is stored.

## Endpoints

- `GET /1.1/{account_id}/hours?since&upto&per_page=1000&page&sort=day&order=asc` (since and upto inclusive, both
  required). Reads `id`, `day`, `duration.total_hours`, `note`, `project.name`, `user.name`, `user.email`, `deleted`,
  `draft`.
- Paging: the parameter schema allows `per_page` up to 5000, the guide says max 100. The app asks for 1000 and stops on
  an empty page or a short page that is not exactly 100 rows (100 may be the server cap), at most 40 pages.
- Rate limits: not documented.

## Subrequest budget

- Fetch: 1 token exchange, 1 call per 1000 entries (or per 100 if the server caps), `GET /api/employees` and
  `GET /api/projects` once.
- Post one: 2 ReAI calls (duplicate lookup, POST).
- Post all: 1 `GET /api/timesheets` for the whole date range, then up to 40 POSTs with concurrency 4. Remaining entries
  are posted by clicking again; entries already in ReAI are skipped.

## ReAI endpoints

- `GET /api/employees`, `GET /api/projects`
- `GET /api/timesheets?startDate&endDate[&employeeId]` (duplicate key: employee, date, hours, project, comment)
- `POST /api/timesheets` (`employeeId`, `date`, `hours`, optional `projectId`, `comment`)

## Mapping

- `day` is a calendar date and is used as is. Hours from `duration.total_hours` (else `total_minutes / 60`), 2 decimals,
  0.01 to 24. Drafts and deleted entries are skipped.
- Comment `[Timely] <project>: <note>`.

## Caveats

- `GET /1.1/accounts` is mentioned in the guide but not in the paths, so the user enters the numeric account ID from
  `app.timelyapp.com/<id>/`.
- `estimated`, `timer_state` and `state` (approval) are not filtered; their values are not documented.
- Vendor company per Timely terms is Timely AS, Oslo.

Last verified: 2026-11-28
