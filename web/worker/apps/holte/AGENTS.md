# EG HoltePortalen

Route `/app/holte/`. Docs pages: `web/content/{nb,en}/web-apps/holte/index.md`.

Fetches project time registrations from EG HoltePortalen (formerly Holte) and posts them one by one to ReAI Timesheets.

## Vendor docs

- API reference (Swagger UI): https://smartapizulu.holte.no/index.html, spec https://smartapizulu.holte.no/swagger/1.0/swagger.json
- API tokens: https://smartapizulu.holte.no/Documentation/Tokens.pdf
- No public changelog. OData query options follow OData v4: https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html

## API version

HoltePortalen API `1.0`, the only published Swagger (no 2.0 exists). The optional `api-version` query parameter is not sent. Host `smartapizulu.holte.no` is the only documented host.

## Auth

API token created in HoltePortalen, Settings, API tokens (valid up to one year), sent as `X-Holte-Token` (not bearer).

## Endpoints

- `GET /odata/User?$select=id,firstName,lastName,email` (names; email picks one user)
- `GET /odata/Registration?$filter=date ge <from-1d>T00:00:00Z and date lt <to+2d>T00:00:00Z and absenceCodeId eq null and isNegative eq false[ and userId eq <uuid>]&$select=id,date,totalHours,projectId,userId,comment,absenceCodeId,isNegative`
- `GET /odata/Project?$select=id,projectName,projectNumber` (only when registrations exist)

All collection reads add `$orderby=id&$count=true&$top=500&$skip`.

## Paging, limits, budget

Pages of 500 until `@odata.count` is reached (or a short page when no count is returned), at most 15 pages per collection. Usually 3 subrequests per fetch, at most 45. No documented rate limit. Post one entry: 2 ReAI subrequests.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- Page load: `GET /api/employees`, `GET /api/projects`
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check on comment prefix `[Holte <first 8 of registration id>]`), then `POST /api/timesheets`

## Mapping

`date` is a date-time; midnight values keep their day, UTC instants are converted to the Europe/Oslo day, and only days inside the period are kept. `totalHours` rounded to 2 decimals; outside 0.01 to 24 skipped. Registrations without `projectId`, with `absenceCodeId` or `isNegative` are skipped (also checked locally).

## Caveats

- The Swagger lists OData collections and a `/$count` route but not the query options; `$filter`, `$select`, `$orderby`, `$count`, `$top` and `$skip` are standard OData v4 and unverified against a live token.
- Whether `date` is local midnight or a UTC instant is not documented; both are handled.
- HoltePortalen also exposes invoices and credit notes; not used.

Last verified: 2026-11-28.
