# Access Fonn Hours Sync

Route `/app/fonn/`. Docs pages: `web/content/{nb,en}/web-apps/fonn/index.md`.

## Purpose

Fetches Fonn time cards per project and week and logs them, one click per row, as ReAI timesheet rows. Hours only: the Fonn API has no materials or invoice basis.

## Vendor docs

- Getting started (keys, headers): https://api-developer.fonn.io/getting-started
- API reference (Azure API Management portal): https://api-developer.fonn.io/developer/apis/fonn-api/operations?api-version=2022-04-01-preview
- Operation details as JSON: `https://api-developer.fonn.io/developer/apis/fonn-api/operations/<operation-id>?api-version=2022-04-01-preview` (for example `returns-time-cards`, `returns-time-cards-external`)
- Webhooks: https://webhooks.docs.fonn.com/
- No changelog or deprecation page is published; the portal lists a single API (`fonn-api`, path `api`).

## API version and auth

- Fonn API, single unversioned API at `https://ws2.fonn.io/api` (the `api-version` in portal URLs is the APIM portal version, not the Fonn API).
- Two headers: `Ocp-Apim-Subscription-Key` (developer portal → Profile, after Fonn activates the subscription) and `Authorization: <access token>` without `Bearer` (Fonn → ORGANIZATION → Integrations → API → Generate token, organization admin).

## Endpoints used

- Only without organization id: `GET /projectsGroups?page=1&limit=50`, then `GET /projects/{id}` for `data.organizationId.id`.
- `GET /organizations/{organizationId}/projects?page&limit=50[&projectNumber]` (meta.pagination.nextPage).
- `GET /projects/{projectId}/time-cards/{periodFrom}`: the seven days from `periodFrom` (documented example 2022-10-23 returns 23 to 29 October), so one call per project and week; dates are `YYYY-MM-DDT10:00:00Z` day stamps and the date part is used.
- Names (optional, skipped when the budget is used up): `GET /projects/{id}/members?page=1&limit=100` (active members), `GET /projects/{id}/client`, `GET /projects/{id}/time-classifications/{id}` once per distinct classification.

## Paging, limits, subrequest budget

- Period at most 62 days. Projects × weeks may not exceed 30 time card calls, else a clear error asks for a project number or a shorter period (checked before any time card call).
- Total Fonn calls per fetch capped at 45; name lookups use what is left. Six calls run concurrently. No rate limit is documented; APIM may answer 429, which surfaces as an error.
- Typical: one project, one month = 1 + 5 + 2 + classifications ≈ 10. Fetch also calls `GET /api/employees` and `GET /api/projects` once.
- Log action: `GET /api/timesheets` (duplicate check) + `POST /api/timesheets` = 2.

## ReAI endpoints

- `GET /api/employees`, `GET /api/projects?archived=false`
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check on comment prefix `[Fonn <ref>]`)
- `POST /api/timesheets` (`employeeId`, `date`, `hours`, optional `projectId`, `comment`)

## Mapping

- Hours = `seconds` / 3600 rounded to two decimals; zero rows and dates outside the period are dropped; cards are deduplicated on project, user, date, classification and checklist item.
- Ref `FONN-<date>-<hash>` is a stable hash of that key, since time cards have no id or approval status.
- Employee by exact member name, else the chosen fallback; one chosen ReAI project for all rows.

## Caveats

- Members beyond the first 100 active ones and blocked members show without a name.
- Not tested against a live key; tests use the portal's documented examples.
- fonn.com redirects to The Access Group (product "Access Fonn"); fonn.no is an unrelated company.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
