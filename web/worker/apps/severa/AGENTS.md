# Severa

Route `/app/severa/`. Docs pages: `web/content/{nb,en}/web-apps/severa/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api.severa.visma.com/rest-api-doc
- https://api.severa.visma.com/psapublicrest/openapidocs/v1.0/doc.json

- Mode: rename
- Calls: POST /rest-api/v1.0/token {client_Id, client_Secret, scope:'hours:read'} → access_token; GET /workhours?eventDateStart&eventDateEnd&rowCount=100 with pageToken paging from the NextPageToken header; maps eventDate, quantity, description/workType.name, user.name, project.name + phase.name; optional user filter; ReAI employee/project chosen on the API form; POST /api/timesheets. CSV removed. Brand now 'Severa'.
- Hosts in code: `api.severa.visma.com`
- Vendor status: severa.com live (2026), 'Severa is part of Visma Group', product sold; www.visma.com/severa redirects to severa.com. Finnish company, not in Brønnøysund.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Needs the Severa REST API add-on and an admin to create client credentials. Rate limit 10 calls/s. Period limited to 93 days (our guard). web/test/provider-api.test.mjs (shared) still calls the old fetchApi credential names and response shapes for this slug and will fail until it is updated or dropped.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
