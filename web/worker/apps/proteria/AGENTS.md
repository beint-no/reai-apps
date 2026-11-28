# Proteria Frakt Freight Rebilling

Route `/app/proteria/`. Docs pages: `web/content/{nb,en}/web-apps/proteria/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://proteria.atlassian.net/wiki/spaces/PFWS/pages/3888119809/CloudConnect+API
- https://cloudconnect.proteria.com/swagger.json
- https://proteria.no/api/
- https://proteria.no/hjelpesenter/hvordan-hente-ut-fakturaspesifikasjoner/
- https://proteria.atlassian.net/wiki/spaces/PFWS/pages/790233140
- https://proteria.no/hjelpesenter/slik-finner-du-api-nokkelen-din-til-proteria-frakt/

- Mode: csv
- Auth: No API read access needed. Customer downloads Fakturarapport as CSV from reportingweb.proteria.com (Lag Rapport -> Fakturarapport). (CloudConnect API key exists under Proteria Web -> your name -> Din Proteria API nokkel, Authorization: Bearer, but the API is write only.)
- Hosts in code: `cloudconnect.proteria.com`, `proteria.atlassian.net`, `proteria.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. proteria.no live, sells freight agreements and shipping software.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`

## Caveats

CSV mode because CloudConnect (the Proteria Frakt API) only creates shipments, orders, labels and print jobs; no endpoint lists shipments or freight costs (only a per-shipment TrackingStatus webhook for API-created shipments). The Fakturarapport column list is not published (documented names: ProTeriaInvoiceNr, SenderName, SenderCountry, SenderPostalCode, DiscountPercent, AmountWithoutVAT), so the app has a column mapping step after upload with AmountWithoutVAT preselected; dates accept YYYY-MM-DD and DD.MM.YYYY. Creates draft customer orders (logistra pattern) in NOK, one click per row. No partner email on proteria.no; partner programme is a form at https://proteria.no/partnerprogram/.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
