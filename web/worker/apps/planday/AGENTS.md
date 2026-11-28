# Planday Shift & Hours Sync

Route `/app/planday/`. Docs pages: `web/content/{nb,en}/web-apps/planday/index.md`.

Reads the approved shifts of one Planday employee and posts each shift's hours to ReAI Timesheets.

## Vendor docs

- Authorization: https://openapi.planday.com/gettingstarted/authorization/
- Rate limiting: https://openapi.planday.com/gettingstarted/rate-limiting/
- Schedule API reference: https://openapi.planday.com/api/schedule
- Scheduling spec: https://openapi.planday.com/scheduling/swagger/v1.0/swagger.json
- HR spec: https://openapi.planday.com/hr/swagger/v1.0/swagger.json
- Release notes: https://openapi.planday.com/gettingstarted/release_notes

## API version and auth

- Scheduling v1.0 for shifts (v2.0 only covers sections; shifts are not deprecated), HR v1.0 for
  departments. Both are the newest versions for these resources.
- A Planday admin creates an API application (Settings → Integrations → API Access) with
  `shift:read` and `department:read`, authorizes it and copies the App ID and refresh token.
- One token exchange per fetch: `POST https://id.planday.com/connect/token`
  (`client_id`, `grant_type=refresh_token`, `refresh_token`), then `Authorization: Bearer` and
  `X-ClientId: <App ID>` on every call.

## Endpoints

- `GET /hr/v1.0/departments?limit=500&offset=` (names; `paging.total`).
- `GET /scheduling/v1.0/shifts?from&to&employeeId&shiftStatus=Approved&limit=5000&offset=`
  (5000 is the documented maximum; `paging.total`). Fields: `id`, `employeeId`, `departmentId`,
  `date`, `startDateTime`, `endDateTime`, `comment`, `manualBreaks[].isPaidBreak`.
- Rate limits: 20 requests per second and 750 per minute per portal; 429 with
  `x-ratelimit-reset`. A fetch uses about 3 calls.

## Subrequests per action

- Page load (connected): `GET /api/employees` + `GET /api/projects` pages.
- Fetch: 1 token + 1 department page + 1 shift page (typical).
- Post one row: 1 `GET /api/timesheets` (same employee and day) + 1 `POST /api/timesheets`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees`, `GET /api/projects`
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check on the comment marker `[Planday shift <id>]`)
- `POST /api/timesheets` (`employeeId`, `date`, `hours`, optional `projectId`, `comment`)

## Mapping

- Hours = `endDateTime - startDateTime - unpaid manualBreaks`, rounded to 0.01 h; date = shift `date`.
- Comment = `[Planday shift <id>] <shift comment>`. Department is shown in the preview only.

## Caveats

- One Planday employee per fetch, because ReAI timesheets are per employee; the user maps the
  Planday employee id to a ReAI employee.
- The shift response lists only manual breaks (release note 17.11.2026). Breaks from the
  portal's break rules are not returned, so hours can be too high where break rules apply; the
  docs tell the user to check. `GET /scheduling/v1.0/timeandcost/{departmentId}` excludes all
  breaks (also paid ones) and needs `timeandcost:read`, so it is not used.
- Shift times are wall clock values in the shift's `timeZone`; a shift that spans a DST change is
  off by one hour.
- Access token lifetime and refresh token rotation are not documented; the refresh token is
  used as given each time.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
