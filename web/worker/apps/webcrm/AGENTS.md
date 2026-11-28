# webCRM Deliveries to ReAI Orders

Route `/app/webcrm/`. Docs pages: `web/content/{nb,en}/web-apps/webcrm/index.md`.

Purpose: turn webCRM deliveries (won orders) created in a period into draft ReAI orders, and create the missing ReAI
customers from the deliveries' organisations.

## Vendor docs

- Reference and rate limits: https://api.webcrm.com/documentation/index.html
- OpenAPI 2.0 spec: https://api.webcrm.com/swagger/v1/swagger.json (`webCRM REST API`, v1, contact api@webcrm.com)
- Getting started (token, subscription): https://webcrm.com/nl/support/api/rest-api
- No public changelog found.

## API version and auth

- REST API v1 (`https://api.webcrm.com`), the only published version.
- The customer creates an application token under Configuration → Integration → API → REST (webCRM Plus or
  Enterprise). The worker exchanges it once per fetch: `POST /Auth/ApiLogin` (form field `authCode`) returns
  `AccessToken` (valid one hour), sent as `Authorization: Bearer`. `IsError`/`ErrorDescription` are shown on failure.

## Endpoints

- `GET /Deliveries/FindByCreateDates/{from}/{to + 1 day}?Page=n&Size=1000` (startDate <= createDate < endDate,
  Size max 1000 per the spec), up to 3 pages. Deliveries with `DeliveryOrderValue > 0` are kept. Fields:
  `DeliveryId`, `DeliveryNumber`, `DeliveryDescription` (fallbacks `DeliveryOpportunityDescription`, `DeliveryProduct`),
  `DeliveryOrderValue`, `DeliveryCurrencySymbol` (fallback `DeliveryOpportunityCurrencySymbol`),
  `DeliveryOrganisationId`, `DeliveryOrderDate` (fallbacks `DeliveryWonDate`, `DeliveryCreatedAt`, Europe/Oslo date).
- `GET /Organisations/{id}` for each distinct organisation, five at a time, at most 20 per fetch (then an error asks
  for a shorter period). Fields: `OrganisationName`, `OrganisationVatNumber` (Norwegian org. no. extracted with
  Mod11), `OrganisationAddress`, `OrganisationPostCode`, `OrganisationCity`, `OrganisationCountryData.CodeISO`
  (fallback `OrganisationCountry`).
- Rate limit 250 requests per minute per token (429 with `Retry-After`); a fetch uses at most 24.

## Subrequests per action

- Fetch: 1 login + 1 to 3 delivery pages + up to 20 organisations + ReAI customer pages (usually 1). Typically 4 to 10,
  at most 27.
- Create customer: optional `GET /api/customers?organizationNumber=` + `POST /api/customers`.
- Stage order: `GET /api/orders?externalReference=webcrm-delivery-<id>` + `POST /api/orders`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers` (match by organization number, then exact name), `GET /api/customers?organizationNumber=`,
  `POST /api/customers` (`name`, `countryCode`, `privateContact: false`, `skipRegistryLookup`, `organizationNumber`,
  `addressPart1`, `postalCode`, `city`)
- `GET /api/orders?externalReference=`, `POST /api/orders` (`customerId`, `currencyCode`, `daysUntilDue` 14,
  `issueDate`/`orderDate` = delivery order date, `externalReference`, `comment`, one `orderLines` entry with
  `itemName`, `quantity` 1, `unitPrice` = order value)

## Caveats

- No live verification (no webCRM account). Field names come from the published spec.
- The path date format of FindByCreateDates is not documented; `YYYY-MM-DD` is sent.
- Deliveries are chosen by creation date, not won date, because webCRM has no documented date filter on won date.
- webCRM does not say whether `DeliveryOrderValue` excludes VAT; it is used as the net price and ReAI applies the
  customer's default VAT code. Quotation lines (`/Deliveries/{id}/QuotationLines`) are not read, so orders have one
  line; the docs tell the user to check before invoicing.
- The delivery and organisation JSON travel in hidden form fields between preview and staging (browser only).
- Nothing is written back to webCRM (`DeliveryErpStatus`/`DeliveryErpId` are left as they are).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
