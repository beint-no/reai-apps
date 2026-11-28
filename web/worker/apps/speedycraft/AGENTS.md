# SpeedyCraft Work Order Sync

Route `/app/speedycraft/`. Docs pages: `web/content/{nb,en}/web-apps/speedycraft/index.md`.

Purpose: fetch SpeedyCraft service hours and materials for a period, log hours as ReAI timesheet rows and stage each
work order total as a draft ReAI order.

## Vendor docs

- Start: https://www.devinco.com/developer/speedycraft/start/
- Auth: https://www.devinco.com/developer/speedycraft/connect/
- Paging and filters: https://www.devinco.com/developer/speedycraft/paging-filtering-and-sorting/
- Reference: https://api.speedycraft.devinco.com/scalar (OpenAPI https://api.speedycraft.devinco.com/openapi/v1.json)
- Changelog: https://www.devinco.com/developer/speedycraft/changelog/ points to the Devinco Help Center section
  https://support.devinco.com/hc/en-us/sections/38114248109597-SpeedyCraft-API (blocks automated reads)

## API version

SpeedyCraft REST API v1 (`SCImpExpREST | v1`, 1.0.0), the only published version (`/openapi/v2.json` is 404). None of
the endpoints used are deprecated. `TblAssignment.InvoiceStatusId` and `InvoiceDate` are marked deprecated and are not used.

## Auth

Devinco support (support@devinco.com) issues a `subjectId` and `apiKey` for the integration user plus the SpeedyCraft
client GUID. Cloud hosted SpeedyCraft only. The worker posts `{ clientId: 3, subjectId, apiKey }` to
`https://connect.devinco.com/Token/GenerateAccessTokenFromCache` once per fetch, then sends
`Authorization: Bearer <token>` and `clientId: <GUID>`. The token response body is undocumented; a bare or JSON string
and `accessToken`, `access_token` or `token` fields are accepted. This call bypasses `fetchJson` because the body may be
a bare string.

## Endpoints

All `GET https://api.speedycraft.devinco.com/api/<Entity>?Filters&Page&PageSize=200` (default page size 200, no
documented maximum; plain JSON arrays; a short page ends the list):

- `AssignmentService` with `ServiceDate>=from,ServiceDate<to+1,Approved!=2` (rejected hours skipped)
- `AssignmentProduct` with `RegDate>=from,RegDate<to+1`
- `Service` and `Employee` (full lists)
- `Assignment` by `AssignmentId==a|b|…` and then `Customer` by `CustomerId==…`, in chunks of 100 ids, four at a time

Rate limits are not documented. Subrequest budget: at most 40 SpeedyCraft calls per fetch including the token call;
beyond that the user is asked for a shorter period. A typical month is 7 calls plus 3 to 5 ReAI calls.

## ReAI endpoints

- `GET /api/customers?archived=false`, `GET /api/employees`, `GET /api/projects?archived=false` (page load and preview)
- Stage: `GET /api/orders?externalReference=speedycraft-<AssignmentIdtext>`, then `POST /api/orders`
- Log hours: `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check), then `POST /api/timesheets`

## Mapping

- Hours = `Quantity` on service lines whose service type has `IncludeInTotal != false` and `ServiceType != 1`
  (absence). Comment tag `[SpeedyCraft <AssignmentIdtext>-<AssignmentServiceId>]` blocks a second post.
- Work order total ex. VAT = sum of round(`Quantity * ModPrice` (services) or `ModPriceOut` (products)
  `* (1 - ModDiscount)` × 100) in minor units; `ModDiscount` 0.1 means 10 percent (spec). Absence lines are excluded;
  driving and extra cost lines are billed. One draft order per Assignment, one line, default VAT, currency = the ReAI
  company currency (SpeedyCraft carries no currency field). `SysDeleted` and hidden (`ShowRecord=false`) rows are skipped.
- Customer and employee are matched by name, with fallbacks chosen in the form.

## Caveats

- SpeedyCraft has no invoice basis endpoint and no documented invoiced flag on service lines, so already invoiced work
  can be staged; the ReAI duplicate check works per work order.
- Devinco says API transaction fees may apply. Docs list two test auth hosts; the production host is used.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
