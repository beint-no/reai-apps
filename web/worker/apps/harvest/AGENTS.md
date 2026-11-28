# Harvest

Route `/app/harvest/`. Docs pages: `web/content/{nb,en}/web-apps/harvest/index.md`.

Fetches finished Harvest time entries for a month and posts them one by one to ReAI Timesheets.

## Vendor docs

- Time entries reference: https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/
- Authentication: https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/
- Pagination: https://help.getharvest.com/api-v2/introduction/overview/pagination/
- General (rate limits, User-Agent): https://help.getharvest.com/api-v2/introduction/overview/general/
- Docs index (no public changelog page): https://help.getharvest.com/api-v2/

## API version

Harvest API v2, the current version (v1 is legacy).

## Auth

Personal Access Token from https://id.getharvest.com/developers as `Authorization: Bearer <token>`, plus `Harvest-Account-Id` and a `User-Agent` with app name and link (required, else 400).

## Endpoints

- `GET https://api.harvestapp.com/v2/time_entries?from&to&is_running=false[&user_id]&per_page=2000`, then each `links.next` URL (documented way to page; covers cursor pagination, where `next_page` is null). Next links to other hosts are ignored.

Fields used: `id`, `spent_date`, `hours`, `notes`, `task.name`, `project.name`, `user.name`.

## Paging, limits, budget

`per_page` 2000 (documented maximum), at most 10 pages. Rate limit 100 requests per 15 seconds (429 with `Retry-After`); one preview stays far below it. Preview: 1 subrequest per 2000 entries. Post one entry: 2 ReAI subrequests.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- Page load: `GET /api/employees`, `GET /api/projects`
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check on comment prefix `[Harvest <entry id>]`), then `POST /api/timesheets` (`employeeId`, `date`, `hours`, optional `projectId`, `comment`)

## Mapping

`spent_date` is the timesheet date; `hours` (not `rounded_hours`) rounded to 2 decimals. Entries outside 0.01 to 24 hours are skipped.

## Caveats

- Without a Harvest user ID, entries for every user the token can see go to the one chosen ReAI employee.
- Billable rates and invoicing state are not used.

Last verified: 2026-11-28.
