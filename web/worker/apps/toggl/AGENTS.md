# Toggl Track Sync

Route `/app/toggl/`. Docs pages: `web/content/{nb,en}/web-apps/toggl/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://engineering.toggl.com/docs/track/api/time_entries/
- https://engineering.toggl.com/docs/track/authentication/

- Mode: keep
- Calls: Module unchanged. NB/EN docs pages rewritten to drop em dashes and describe what is imported.
- Hosts in code: `api.track.toggl.com`
- Vendor status: toggl.com live; Track API v9 docs current at engineering.toggl.com/docs/track/api/time_entries/. Estonian company, not in Brønnøysund.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Shows 'Project #id'; meta=true would add project_name (documented) if nicer labels are wanted. Only the token owner's own entries are read.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
