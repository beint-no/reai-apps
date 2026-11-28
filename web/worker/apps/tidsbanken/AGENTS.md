# Tidsbanken Timesheet Sync

Route `/app/tidsbanken/`. Docs pages: `web/content/{nb,en}/web-apps/tidsbanken/index.md`.

Reads approved Tidsbanken time lines for a period and posts chosen lines to ReAI Timesheets for one ReAI employee and
project.

## Vendor docs

- API list (Azure APIM portal): https://developer.tidsbanken.net/apis
  (machine readable: `https://developer.tidsbanken.net/developer/apis?api-version=2022-04-01-preview`, operations under
  `/developer/apis/<api-id>/operations`)
- Timelinje GetTimelinje: https://developer.tidsbanken.net/developer/apis/api-timelinje-clone-2-v4/operations/GetTimelinje?api-version=2022-04-01-preview
- OData: https://developer.tidsbanken.net/odata , paging: https://developer.tidsbanken.net/pagination
- Keys: https://developer.tidsbanken.net/products , https://developer.tidsbanken.net/find-your-tb-key
- Changelog: none published; versions are visible in the API list.

## API version and auth

- `x-api-version: 3.0` for Timelinje, Ansatt and Prosjekt. Timelinje also has 3.1 (version set `x-api-version`
  header), but 3.1 only contains `/timeeksport`; `TimelinjeBehandlet` exists in 3.0 only.
- Headers on every call: `tb-key` (Tidsbanken admin: wrench icon, Integrasjon, API-nøkkel, Hent API-nøkkel; needs an API
  licence) and `Ocp-Apim-Subscription-Key` (subscription to the Public product on the developer portal).

## Endpoints

- `GET /timelinje/TimelinjeBehandlet?$select=Id,AnsattId,Dato,AntallTimer,ProsjektId,Notat,Godkjent,Timetype&$filter=Dato ge <from-1> and Dato le <to+1> and Godkjent eq true&$orderby=Dato&$top=10000`
- `GET /ansatt/ansatt?$select=Id,Fornavn,Etternavn&$top=10000` (names; replaces an undocumented `$expand=Ansatt`)
- `GET /prosjekt/Prosjekt?$select=Id,Navn&$top=10000` (only when a line has a project)
- Paging: 10,000 rows per page, then `@odata.nextLink` (followed only on api.tidsbanken.net, at most 10 pages).
- Rate limit: 300 calls per 60 seconds (documented on each API).

## Subrequest budget

- Fetch: 3 calls normally (timelines, then employees and projects in parallel); 1 more per extra 10,000 lines.
- Post one line: 2 ReAI calls (duplicate lookup, then POST).
- Page load: `GET /api/employees` and `GET /api/projects?archived=false` pages.

## ReAI endpoints

- `GET /api/employees`, `GET /api/projects?archived=false`
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check: same hours, comment and project)
- `POST /api/timesheets` (`employeeId`, `date`, `hours`, optional `projectId`, `comment`)

## Mapping

- Date: Europe/Oslo day of `Dato`. The docs warn of a wrong time zone shift on date fields, so the filter has one day of
  margin each side and values with an offset are converted to the Oslo day before the period check.
- `Timetype` `Tillegg` and `Enhetstillegg` are allowances or units, not hours, and are skipped.
- Hours: `AntallTimer` rounded to 2 decimals, 0.01 to 24.
- The optional employee name filter is local (contains match on Fornavn + Etternavn).

## Caveats

- How the time zone shift shows in real responses is not documented; the margin and conversion are defensive.
- Timesheets are not vouchers; no VAT or accounts are involved.
- apps.json may still name it 'ReAI Tidsbanken / SmartDok Import'.

Last verified: 2026-11-28
