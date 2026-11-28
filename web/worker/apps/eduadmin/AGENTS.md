# EduAdmin Bookings to ReAI Orders

Route `/app/eduadmin/`. Docs pages: `web/content/{nb,en}/web-apps/eduadmin/index.md`.

Purpose: fetch confirmed EduAdmin course bookings in a period that are not invoiced yet and stage each one as a ReAI
order (invoice basis) for the booking customer, then mark the booking as invoiced in EduAdmin. This mirrors what
EduAdmin's own invoice export does for Tripletex ("EduAdmin fakturaeksport").

## Why orders and not vouchers or invoices/import

EduAdmin bookings are an invoice basis: EduAdmin does not issue numbered invoices, it marks bookings as invoiced once
the accounting system has invoiced them. A ReAI order keeps the customer, lines and VAT per line and is invoiced from
ReAI with its own number, KID and reminders. A summary voucher would lose the customer ledger, and `invoices/import`
is for invoices already numbered in another system.

## Vendor docs

- Reference (Redoc): https://api.eduadmin.se (Authentication and OData sections)
- OpenAPI: https://api.eduadmin.se/swagger/v1/swagger.json ("EduAdmin API", v1)
- OData metadata: https://api.eduadmin.se/v1/odata/$metadata (Customer and OrderRows are navigation properties of Booking)
- Developers page: https://www.eduadmin.com/contact/developer ("To access API credentials, please create an API user in EduAdmin")
- Official PHP client (response `value` envelope): https://github.com/MultinetInteractive/eduadmin-api-phpclient

## API version

EduAdmin API v1 (`/v1/...`), the only published version; reads use OData v4.

## Auth

`POST https://api.eduadmin.se/token` with body `username=…&password=…&grant_type=password` (`Content-Type: text/plain`
as documented); response `access_token`, `expires_in` 86400. Calls send `Authorization: Bearer <token>`. The
customer uses an EduAdmin API user. The password is used once per fetch; the 24 hour token is kept in the preview's
hidden form fields for the per row import (browser only, never stored).

## Endpoints

- `GET /v1/odata/Bookings?$filter=Preliminary eq false and Invoiced eq false and BookingDate ge <Oslo midnight> and
  BookingDate lt <Oslo midnight after last day>&$select=…&$expand=Customer($select=…),OrderRows&$orderby=BookingId&$top=200&$skip=&$count=true&cache=false`,
  paged by `$skip` until `@odata.count` is reached (cap 10 pages). `cache=false` because OData responses are cached.
- `GET /v1/odata/Bookings/{id}?$select=…&$expand=…` to re-read the booking before staging.
- `PATCH /v1/Booking/{id}` with `{ "MarkedAsInvoiced": true }` after the ReAI order exists.

## Subrequests per action

- Fetch: EduAdmin 1 token + 1 per 200 bookings.
- Stage one booking: ReAI order duplicate check 1, EduAdmin booking 1, ReAI VAT codes and invoice settings 2,
  customer lookup 1 to 3, customer create 0 or 1, order create 1, EduAdmin PATCH 1. At most 10.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/vat-codes?usage=customer_invoice`
- `GET /api/invoice-settings` (daysUntilDue)
- `GET /api/customers` (organizationNumber, email, name filters), `POST /api/customers`
- `GET /api/orders?externalReference=eduadmin-booking-<id>&status=all`, `POST /api/orders`

## Mapping

- One billable OrderRow → one order line: itemName = Description, quantity = Quantity, unitPrice excl. VAT
  (PricePerUnit, divided by 1 + VatPercent when PriceIncVat), whole-number DiscountPercent as `discount`, otherwise
  folded into the price. VAT code: ReAI output code for the rate; rows with 0 % use the code the user picks
  (default the exempt code; courses are often outside the VAT scope).
- Bookings whose rows do not add up to TotalPriceExVat (for example coupons on the booking), free bookings and bookings
  without billable rows are shown but cannot be staged.
- Customer: matched by valid Norwegian OrganisationNumber, then Email, then exact name; else created (private when no
  organisation number). Order currency is the ReAI company currency (the booking has no currency field); orderDate is
  the booking date in Europe/Oslo; buyerReference = Reference and PurchaseOrderNumber.

## Caveats

- Not verified against a live account. The exact EduAdmin menu for creating an API user is not documented publicly;
  the docs page tells customers to ask EduAdmin support if they cannot find it.
- The API user needs rights to read bookings and to patch them; if the PATCH fails the order stays and the user is told
  to mark the booking in EduAdmin.
- Card and cash bookings are staged as orders too; the payment must be registered on the ReAI invoice.
- Programme bookings (`/v1/odata/ProgrammeBookings`) are not read.

## Vendor contact

hello@eduadmin.no (listed on https://www.tripletex.no/integrasjoner/eduadmin-fakturaeksport/).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
