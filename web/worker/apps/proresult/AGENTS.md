# Proresult Hours Import

Route `/app/proresult/`. Docs pages: `web/content/{nb,en}/web-apps/proresult/index.md`.

Imports a Proresult hour report as ReAI timesheet rows and stages unbilled hours per project and month as ReAI draft orders.

## Vendor docs

- Integrations (no customer API): https://support.proresult.no/integrasjoner-proresult
- Hour reports: https://support.proresult.no/rapporter-for-timer
- Invoicing module: https://support.proresult.no/faktureringsmodulen
- File exports: https://support.proresult.no/fileksporter

API version: none. Proresult documents no customer API; integrations are built by Proresult on request (support@proresult.no). Re-checked 2026-11-28: no public API reference or developer portal.

Input: report Rapporter → Timer → Timelister egendefinert, exported to Excel and saved as CSV (semicolon or comma). Documented columns used: Dato, Prosjekt, Prosjektnummer, Ansatt, Kunde, Kommentar, Timetype, Timetype-pris, Fakturert. The hours column header is not named in the docs, so Timer, Sum timer, Ordinære timer, Antall timer or Antall are accepted. The header row is searched in the first 15 lines (Excel title rows).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers?archived=false`, `GET /api/employees`, `GET /api/projects?archived=false` (mapping lists, loaded on page view and preview)
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check), `POST /api/timesheets` (employeeId, date, hours, projectId, comment)
- `GET /api/orders?externalReference&pageSize=1` (duplicate check), `POST /api/orders` (customerId, currencyCode NOK, daysUntilDue 14, issueDate, orderDate, externalReference, comment, projectId, one order line)

Subrequests: preview = customer and project pages (200 per page) + 1 employees call; log hours = 2; stage order = 2.

## Mapping

- Each hour row becomes one timesheet row; the comment starts with `[Proresult PR-<date>-<employee>-<n>]`, where n counts that employee's rows on that day in file order, so the same row gets the same reference in any report period. A timesheet with that prefix on the same employee and day is shown as already logged.
- Rows not marked Fakturert are priced hours × Timetype-pris in øre and summed to one draft order per project and month (externalReference `proresult-<projectNo>-<YYYY-MM>`). A month that is already staged is shown, not updated, when more hours arrive later.
- Employees and customers are matched by name, with fallbacks chosen by the user; one optional ReAI project for all rows.

## Caveats

- Hours column name unverified against a real export.
- Amounts are assumed NOK and excluding VAT; sales account and VAT code are set on the draft order in ReAI.
- Invoice basis that Proresult already sends to another accounting system must not be staged again (stated in the docs page).

Last verified: 2026-11-28
