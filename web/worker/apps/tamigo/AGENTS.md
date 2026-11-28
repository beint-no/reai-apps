# Tamigo

Route `/app/tamigo/`. Docs pages: `web/content/{nb,en}/web-apps/tamigo/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://tamigono.freshdesk.com/support/solutions/articles/5000867116-api-dok-pr-01-04-2024-full-versjon
- https://tamigono.freshdesk.com/support/solutions/articles/5000793304-application-services-
- https://tamigono.freshdesk.com/support/solutions/folders/5000296483

- Mode: fix
- Calls: POST https://api.tamigo.com/login/application {Name, Key} → SessionToken; GET /attendance/CheckInOutOverview/?startDate&endDate&departmentId=all with header x-tamigo-token; maps Date (/Date(ms+zzzz)/ to local date), ActualShiftHours, EmployeeName, WageSystemKey (filter), DepartmentName, ActualShiftText · ActualShiftComment; skips zero-hour rows; POST /api/timesheets. CSV removed.
- Hosts in code: `api.tamigo.com`, `tamigono.freshdesk.com`
- Vendor status: Brønnøysund: Tamigo Norge AS active; tamigo.com and tamigo.com/no live (© 2026); API docs updated 26 Nov 2024 on tamigono.freshdesk.com.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Docs are PDFs attached to the article (Application Services, section Attendance Services c) Get Check-in/Check-out Overview). Docs do not state a max range; our guard is 93 days. web/test/provider-api.test.mjs (shared) still calls the old fetchApi credential names and response shapes for this slug and will fail until it is updated or dropped.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
