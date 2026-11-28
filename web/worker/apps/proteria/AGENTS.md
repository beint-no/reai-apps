# Proteria Frakt Freight Rebilling

Route `/app/proteria/`. Docs pages: `web/content/{nb,en}/web-apps/proteria/index.md`.

Reads the Proteria Frakt invoice report (Fakturarapport) and stages freight per shipment as ReAI draft customer orders for rebilling.

## Vendor docs

- CloudConnect API: https://proteria.atlassian.net/wiki/spaces/PFWS/pages/3888119809/CloudConnect+API and https://cloudconnect.proteria.com/swagger.json (OpenAPI "Proteria CloudConnect APIs" 2.0.0)
- API key: https://proteria.no/hjelpesenter/slik-finner-du-api-nokkelen-din-til-proteria-frakt/
- Invoice report: https://proteria.no/hjelpesenter/hvordan-hente-ut-fakturaspesifikasjoner/ and https://proteria.atlassian.net/wiki/spaces/PFWS/pages/790233140

API version: none used. CloudConnect 2.0.0 (re-checked 2026-11-28) has label, order (imported customer orders with goods values), pick up point, print, shipment creation, shipping method and template endpoints. None lists shipments or freight costs, so the documented Fakturarapport CSV is the input.

Input: reportingweb.proteria.com → Lag Rapport → Fakturarapport, downloaded as CSV (semicolon, UTF-8). Documented column names include ProTeriaInvoiceNr, SenderName, SenderCountry, SenderPostalCode, DiscountPercent and AmountWithoutVAT; the full list is not published, so the user maps columns after upload (AmountWithoutVAT preselected). Amount, date and shipment number are required. Dates accept YYYY-MM-DD and DD.MM.YYYY. At most 1000 rows and 2 MB.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers?archived=false` (fallback list and name match)
- `GET /api/orders?externalReference=proteria-<shipment>&pageSize=1` (duplicate check), `POST /api/orders` (customerId, currencyCode NOK, daysUntilDue 14, issueDate/orderDate, externalReference, comment, one line with the freight ex. VAT)

Subrequests: preview = 0; map = customer pages (200 per page); stage order = 2.

## Mapping and caveats

- Rows with the same shipment number are summed in øre into one freight line, so surcharge rows are not lost and a shipment is staged once. Lines that sum to zero or less are skipped.
- Receiver is matched to a ReAI customer by name, else the chosen fallback customer.
- Amounts are assumed NOK and excluding VAT; the freight VAT code and sales account are set in ReAI before invoicing.

Last verified: 2026-11-28
