# Kvalitetskontroll Hours Sync

Route `/app/kvalitetskontroll/`. Docs pages: `web/content/{nb,en}/web-apps/kvalitetskontroll/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api.kvalitetskontroll.no/docs/
- https://api.kvalitetskontroll.no/docs/openapi.yaml
- https://api.kvalitetskontroll.no/docs/collection.json
- https://www.tripletex.no/integrasjoner/kvalitetskontroll/

- Mode: api
- Auth: Customer creates a Personal Access Token at https://api.kvalitetskontroll.no/admin (log in with the Kvalitetskontroll user); sent as Authorization: Bearer <token>. Token scopes the company; no tenant id.
- Hosts in code: `api.kvalitetskontroll.no`
- Vendor status: Legal entity Kvalitetskontroll AS (991557415) has slettedato 2024-12-16, apparently folded into the SmartCraft group (staff on kvalitetskontroll.no/om-oss use @smartcraft.com addresses; SmartCraft Norway AS 927150182 is active). kvalitetskontroll.no is live and still sells the quality system for construction.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/employees`
- `/api/orders`
- `/api/projects`
- `/api/timesheets`

## Caveats

Hours only (timesheets); no order staging because KS documents no invoice basis list endpoint and no price on registrations. Uses GET /timetracking/registrations with from_date, to_date, is_approved=1, offset, limit sent as query parameters: Scribe documents these filters as a GET JSON body, so query string use is inferred (Laravel convention), untested live. The list response shape is undocumented (only the single registration and POST 201 example are); code accepts a bare array or {data: []}. duration is minutes after break (example: 08:00 to 12:37 minus 16 = 261). registration_date is UTC midnight of the Oslo day and is converted to Europe/Oslo. Employees, projects and hour types are fetched for names (bare arrays, offset/limit). Which KS role may create a token is undocumented. Customer name is not resolved (project contact needs per contact lookups), so the fallback customer is irrelevant here. KS is now part of SmartCraft (same group as ELinn). Timesheet rows have no duplicate guard.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
