# Husleie.no

Route `/app/husleie/`. Docs pages: `web/content/{nb,en}/web-apps/husleie/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://husleie-no.zendesk.com/hc/no/articles/360009088880-Oversikt-over-leieforhold-under-Rapporter
- https://husleie-no.zendesk.com/hc/no/articles/360009193379-Fakturaliste-og-fakturaspesifikasjon
- https://connectmyapps.atlassian.net/wiki/spaces/SUPPORT/pages/230490152/How+to+add+Husleie.no+as+an+application

- Mode: csv
- Calls: Imports the documented Leieforhold report export (MinHusleie → Rapporter → Leieforhold → CSV): exact then prefix header matching on the Norwegian column names, dd.mm.yyyy dates, skips 'Avsluttet' rows, matches customers by email then name, starts billing on the contract start or the first of next month, VAT code chosen from GET /api/vat-codes?usage=customer_invoice and rechecked on stage, monthly ReAI subscription with automatic billing off.
- Hosts in code: `husleie-no.zendesk.com`
- Vendor status: Brreg: active, 29 employees, no bankruptcy or liquidation flags. husleie.no live with help centre articles updated 2026-09-24; registered with Finanstilsynet.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/subscriptions`
- `/api/vat-codes`

## Caveats

Husleie.no has an API (api.husleie.no; ConnectMyApps uses it), but documentation and credentials come only from Husleie.no customer service, so it is not used. The report's exact column headers are not published; the parser expects Leietaker and Husleie and uses Kontraktstart, Leieobjekt, E-post and Status when present. Verify against a real export. The report requires a professional landlord account.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
