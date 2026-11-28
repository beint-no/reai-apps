# Severa

Route `/app/severa/`. Docs pages: `web/content/{nb,en}/web-apps/severa/index.md`.

Reads Severa work hours for a period and posts chosen lines to ReAI Timesheets for one ReAI employee and optional project.

## Vendor docs

- Guide (auth, paging, rate limits, scopes, changes): https://api.severa.visma.com/rest-api-doc
- OpenAPI specification: https://api.severa.visma.com/psapublicrest/openapidocs/v1.0/doc.json
- Changelog: "API diff" in the specification viewer; release history in the guide's "Latest changes".

## API version

REST API `v1.0` at `https://api.severa.visma.com/rest-api/v1.0`, named in the guide as the current production version (spec version 1.0 on 2026-11-28; no newer version or sunset announced).

## Auth

An administrator enables the REST API add-on and creates client credentials under Settings → REST API with scope `hours:read`. `POST /token` with JSON `{ client_Id, client_Secret, scope }` returns `access_token`; calls send `Authorization: Bearer`. One token per fetch, never stored.

## Endpoints

- `GET /workhours?eventDateStart=&eventDateEnd=&rowCount=100` (100 is the documented maximum). Token paging: send the `NextPageToken` response header back as `pageToken` until it is absent.
- Fields used: `guid`, `eventDate`, `quantity`, `description`, `workType.name`, `user.name`, `project.name`, `phase.name`.
- The optional user name filter is applied locally (the server filter needs a user GUID and an extra lookup).

## Budget and limits

Period at most 93 days. Fetch: 1 token + 1 call per 100 entries, capped at 45 pages (error asking for a shorter period beyond 4,500 entries). Fair use: 10 calls per second and 100,000 per 24 hours per client; `429` is reported as a rate limit message. Post one line: 2 ReAI calls.

## ReAI API

- `GET /api/employees`, `GET /api/projects?archived=false` (page load, for the selectors).
- `GET /api/timesheets?employeeId=&startDate=&endDate=` duplicate check: skips when an entry that day has `(Severa <guid>)` in its comment.
- `POST /api/timesheets` `{ employeeId, date, hours (0.01 to 24, 2 decimals), projectId?, comment }`, comment ends with `(Severa <guid>)`.

## Caveats

Entries over 24 hours or under 0.01 are dropped. Hours are posted as is; billable status and approval are not checked.

Last verified: 2026-11-28.
