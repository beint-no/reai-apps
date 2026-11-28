# Husleie.no Lease Billing

Route `/app/husleie/`. Docs pages: `web/content/{nb,en}/web-apps/husleie/index.md`.

Reads the Husleie.no Leieforhold report (CSV) and stages one monthly ReAI subscription per active agreement, automatic billing off.

## Vendor docs

- Leieforhold report: https://husleie-no.zendesk.com/hc/no/articles/360009088880-Oversikt-over-leieforhold-under-Rapporter
- Invoice list: https://husleie-no.zendesk.com/hc/no/articles/360009193379-Fakturaliste-og-fakturaspesifikasjon
- Their API is only reachable through partners (ConnectMyApps guide, credentials from Husleie.no customer service): https://connectmyapps.atlassian.net/wiki/spaces/SUPPORT/pages/230490152/How+to+add+Husleie.no+as+an+application

## API version

None. No public API documentation exists (rechecked 2026-11-28), so this is an export file import. No provider calls.

## Input

MinHusleie → Rapporter → Leieforhold → CSV (professional landlord account). Columns found by Norwegian header names, exact then prefix: Leietaker and Husleie required; Kontraktstart, Leieobjekt, E-post, Status and an agreement id used when present. Dates `dd.mm.yyyy` or ISO, amounts with decimal comma. `Avsluttet` rows skipped.

## ReAI endpoints and budget

Contract: https://app.reai.no/openapi/public.

- Page load: `GET /api/vat-codes?usage=customer_invoice` (1).
- Preview: vat-codes (1) + `GET /api/customers` all pages (200 each).
- Stage: vat-codes recheck (1) + `GET /api/subscriptions?customerId=&pageSize=200` duplicate check (1) + `POST /api/subscriptions` (1).

## Mapping

Customer matched by email (invoice email or email), then exact name. Subscription: `intervalMonths: 1`, `billingTiming: in_advance`, `periodAlignment: start_date`, `outputMode: create_order`, `automaticBillingGeneration: false`, `currencyCode: NOK`, `daysUntilDue: 14`, one line with `unitPrice` = monthly rent and the chosen VAT code. Billing starts at contract start, or the first of next month for running contracts. Duplicate = an existing monthly subscription for the customer with the same `amounts.discountedSubTotal`.

## Caveats

- Column headers are not published; verify against a real export.
- Rent is treated as the line price; for VAT registered commercial rent check whether Husleie.no's amount includes VAT.
- Husleie.no still collects rent itself; stage only agreements ReAI will invoice.

Last verified: 2026-11-28
