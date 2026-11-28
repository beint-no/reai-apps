# Clockify Sync

Route `/app/clockify/`. Docs pages: `web/content/{nb,en}/web-apps/clockify/index.md`.

Purpose: fetch the API key owner's finished Clockify time entries for one month and post them, one row
per click, to ReAI Timesheets for a chosen employee and optional project.

## Vendor docs

- Reference, auth, rate limits, paging, regions: https://docs.clockify.me/
- OpenAPI used by the reference: embedded in https://docs.clockify.me/ (Redoc)
- Breaking changes and sunsets: https://docs.clockify.me/breaking-changes/
- Where the customer creates the key: https://clockify.me/help/troubleshooting/api-key-and-authentication/where-to-generate-api-key-for-account

## API version

Clockify REST API v1 (`/api/v1`), the only public version. The breaking changes list has one sunset
(`getProjectTotals`, July 2025), which this module does not use.

## Auth

Personal API key from Profile → Preferences → Advanced → Manage API keys, sent as `X-Api-Key`.
Workspaces on a subdomain need a key generated for that workspace. Host per data region: global
`api.clockify.me`, `euc1`, `use2`, `euw2`, `apse2` (`https://<prefix>.clockify.me/api/v1`).

## Endpoints

- `GET /v1/user`: `id` and `activeWorkspace` (fallback `defaultWorkspace`).
- `GET /v1/workspaces/{ws}/user/{userId}/time-entries` with `start`/`end` (one day of padding each
  side, UTC `yyyy-MM-ddThh:mm:ssZ`), `page`, `page-size=200`.
- `GET /v1/workspaces/{ws}/projects` with `page`, `page-size=200`, only when an entry has `projectId`.

Paging ends on the documented `Last-Page: true` response header (short page as fallback when the
header is absent). Max page size is not documented, so 200 is kept.

## Budget and limits

Preview: 1 user + 1 entries page per 200 entries + 1 projects page per 200 projects, typically 3.
Capped at 20 pages each. Rate limit per workspace: Free 30 requests/hour, paid plans 20/s,
Enterprise 50/s. `429` is reported with `Retry-After` and no retry. Import: 2 ReAI calls per row.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees`, `GET /api/projects` (paged via `reaiAll`) for the selects on page load.
- `GET /api/timesheets?startDate&endDate&employeeId[&projectId]`: duplicate check (same day,
  hours, comment and project) before each write.
- `POST /api/timesheets` `{ employeeId, date, hours, projectId?, comment }`.

## Mapping

- Only entries with `timeInterval.end` and `type` `REGULAR` (or missing); `BREAK`, `HOLIDAY` and
  `TIME_OFF` are skipped.
- Hours from `end - start` (ISO `duration` fallback), two decimals, 0.01 to 24.
- Date is the Europe/Oslo day of `timeInterval.start`; entries outside the month are dropped.
- Comment `[Clockify] <description>`; project name shown for review only.

## Caveats

- Reads only the key owner's own entries in the active workspace.
- An entry that crosses midnight is booked on its start day.
- The duplicate check matches on text, so an edited comment is posted again.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
