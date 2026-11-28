# SmartDok

Route `/app/smartdok/`. Docs pages: `web/content/{nb,en}/web-apps/smartdok/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api.smartdok.no/api-docs/
- https://api.smartdok.no/docs/v1

- Mode: fix
- Calls: POST https://api.smartdok.no/Authorize/ApiToken {Token} → session string as Bearer; GET /Users?all=true (Items Id/Name/EmployeeNo); GET /WorkHours?fromDate&toDate&onlyAttested=true&includeExported=true → Items; skips WageAddition/UnitAddition/Diet/machine rows; hours = NetHours (fallback OrdinaryHours); project = ProjectNumber ProjectName · SubProjectName; comment = WageName · Comment; optional employee filter; POST /api/timesheets. Order staging and CSV removed (WorkHours has no amounts).
- Hosts in code: `api.smartdok.no`
- Vendor status: Brønnøysund: active, 64 employees, no konkurs/avvikling; smartdok.no live; API docs live at api.smartdok.no/api-docs/.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

API access must be on the SmartDok plan. /WorkHours allows at most 93 days. NetHours vs OrdinaryHours semantics are not explained in the spec beyond names; NetHours is used when present. web/test/provider-api.test.mjs (shared) still calls the old fetchApi credential names and response shapes for this slug and will fail until it is updated or dropped.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
