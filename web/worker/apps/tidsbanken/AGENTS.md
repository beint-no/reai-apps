# Tidsbanken / SmartDok Import

Route `/app/tidsbanken/`. Docs pages: `web/content/{nb,en}/web-apps/tidsbanken/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.tidsbanken.net/apis
- https://developer.tidsbanken.net/odata
- https://developer.tidsbanken.net/pagination
- https://developer.tidsbanken.net/products
- https://developer.tidsbanken.net/find-your-tb-key
- https://developer.tidsbanken.net/developer/apis/api-timelinje-clone-2-v4/operations/GetTimelinje?api-version=2022-04-01-preview

- Mode: fix
- Calls: GET https://api.tidsbanken.net/timelinje/TimelinjeBehandlet with OData $select=Id,AnsattId,Dato,AntallTimer,ProsjektId,Notat,Godkjent, $filter='Dato ge X and Dato le Y and Godkjent eq true', $expand=Ansatt($select=Fornavn,Etternavn), $top=10000, following @odata.nextLink on api.tidsbanken.net; GET /prosjekt/Prosjekt?$select=Id,Navn for project names; headers tb-key, Ocp-Apim-Subscription-Key, x-api-version: 3.0; POST /api/timesheets. CSV removed.
- Hosts in code: `api.tidsbanken.net`, `developer.tidsbanken.net`
- Vendor status: Brønnøysund: active, 54 employees; tidsbanken.no live; developer portal developer.tidsbanken.net live with Public product.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Needs an API licence in Tidsbanken plus a developer portal subscription key. x-api-version value '3.0' follows the API version names in the portal; the docs do not show a literal example. Docs warn of a known timezone shift on date fields. apps.json still names it 'ReAI Tidsbanken / SmartDok Import'; coordinator may want 'ReAI Tidsbanken'. web/test/provider-api.test.mjs (shared) still calls the old fetchApi credential names and response shapes for this slug and will fail until it is updated or dropped.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
