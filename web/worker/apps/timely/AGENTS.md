# Timely Timesheet Sync

Route `/app/timely/`. Docs pages: `web/content/{nb,en}/web-apps/timely/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.timely.com/
- https://www.timely.com/help/handbook/tips-tricks/getting-started-with-timelys-api/

- Mode: api
- Auth: Workspace admin self-registers an OAuth app in Timely Settings -> Devs (redirect URI https://apps.reai.no/app/timely/). App builds the authorize link (GET /1.1/oauth/authorize, response_type=code, state=accountId), Timely redirects back with ?code, then POST /1.1/oauth/token (authorization_code, client_id, client_secret, code, redirect_uri) and Authorization: Bearer <access_token>. A pasted existing access token also works.
- Hosts in code: `api.timelyapp.com`, `developer.timely.com`, `www.timely.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. timelyapp.com redirects to timely.com, live, sells AI timesheets (Timely by Memory).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Time entries are GET /1.1/{account_id}/hours?since&upto&per_page&page (OpenAPI spec); the spec's guide text also mentions 'until' and max per_page 100, so the app uses since/upto with per_page=100 and stops on a short page (cap 50 pages). The user enters the numeric account ID from app.timelyapp.com/<id>/ because GET /1.1/accounts has no documented response schema. Authorization codes are single use; token and secret never stored. The authorize step returns a plain link (htmx GET) because the app CSP form-action 'self' would block a form redirect to Timely. Employees matched by email or name, projects by name. Vendor company per Timely terms is Timely AS, Oslo (not Memory AS). support@timely.com is the API help address on developer.timely.com.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
