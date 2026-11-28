# Proresult Hours Import

Route `/app/proresult/`. Docs pages: `web/content/{nb,en}/web-apps/proresult/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://support.proresult.no/integrasjoner-proresult
- https://support.proresult.no/rapporter-for-timer
- https://support.proresult.no/faktureringsmodulen
- https://support.proresult.no/fileksporter
- https://www.tripletex.no/integrasjoner/proresult/

- Mode: csv
- Auth: No customer API. Customer exports Rapporter → Timer → Timelister egendefinert to Excel and saves it as CSV.
- Hosts in code: `support.proresult.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. proresult.no live, sells the construction project system.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/employees`
- `/api/orders`
- `/api/projects`
- `/api/timesheets`

## Caveats

Why csv: Proresult documents no customer API; its help centre only says integrations use an API internally and new integrations go via support@proresult.no; api/swagger paths 404 and api.* hosts do not resolve. Export is PDF/Excel only (no CSV), so the user saves the Excel sheet as CSV. Documented columns used: Dato, Prosjekt, Prosjektnummer, Ansatt, Kunde, Kommentar, Timetype, Timetype-pris, Fakturert. The hours column header is NOT named in the docs (options 'Skjul timer', 'Ordinære timer', and 'Sum timer' in Timesum egendefinert), so the parser accepts Timer, Sum timer, Ordinære timer, Antall timer or Antall; verify with a real export. Header row is searched in the first 15 lines (Excel title rows). Unbilled rows (Fakturert not Ja) are priced hours * Timetype-pris and summed to one draft order per project and month (externalReference proresult-<projectNo>-<YYYY-MM>); re-importing the same month after more hours shows the existing draft. Exports parseExport (no fetchApi).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
