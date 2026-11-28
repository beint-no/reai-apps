# Handyman

Route `/app/handyman/`. Docs pages: `web/content/{nb,en}/web-apps/handyman/index.md`.

Fetches completed Handyman (GSGroup) service orders with hours, labour and materials, and lets the user stage each as a ReAI order and log its hours as a ReAI timesheet entry.

## Vendor docs

- Swagger (reference): https://hmapi.gsgroup.io:19000/swagger/ui/index, spec https://hmapi.gsgroup.io:19000/swagger/docs/v1
- API overview: https://support.gsgroup.no/hc/en-us/articles/9651307325713
- API key in ControlCenter: https://support.gsgroup.no/hc/en-us/articles/17674524711441
- Remote https access: https://support.gsgroup.no/hc/en-us/articles/17762953047953
- Orders query parameters (Status, LastChanged, PageSize, StartIndex): https://support.gsgroup.no/hc/en-us/articles/11054099455633 (updated 2026-04-28)
- No changelog page; the Swagger is the only version (`v1`).

## API version

Handyman API `v1` (only version published). The API is self hosted on the customer's Handyman server; the user enters its public https address (SSRF guarded).

## Auth

Headers `apiKey` (set in Handyman ControlCenter, Integration tab) and `HandymanClientId` (client number).

## Endpoints

- `GET /api/orders?status=2&lastChanged=<from>T00:00:00&pageSize=100&startIndex&dateTimeBehaviour=0` (Completed = 2; finish date filtered locally on `OrderHead.ActualFinishDate`, else `FinishDate`; `ExcludeFromInvoice` and `OrderHead.IsInternalOrder` skipped)
- `GET /api/orders/{id}/salarycoderegistrations?pageSize=1000` (`Amount`, `Unit` 0 = hours, `CustomerPrice`, `Rejected`, `ExcludeFromInvoice`)
- `GET /api/orders/{id}/materials?pageSize=1000` (`Quantity`, `CustomerPrice`, `ExcludeFromInvoice`), skipped when `OrderHead.FixedPrice` is set
- `GET /api/customers/{id}` (`CustomerName`), once per unique `InvoiceCustomerReference.Id`, else `CustomerReference.Id`

## Paging, limits, budget

Orders: `startIndex` paging by 100, at most 5 pages. At most 12 orders per fetch; details run 4 at a time. Fetch worst case 5 + 12 * 3 = 41 subrequests, plus ReAI customer pages for name matching. No documented rate limit or maximum page size. Create order: 2 ReAI subrequests. Log hours: 2.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- Page load: `GET /api/customers?archived=false`, `GET /api/employees`, `GET /api/projects`
- `GET /api/orders?externalReference=handyman-HM-<id>&status=all` then `POST /api/orders` (`customerId`, `currencyCode` NOK, `daysUntilDue`, `issueDate`, `orderDate`, `externalReference`, `orderLines[{itemName, quantity, unitPrice}]`)
- `GET /api/timesheets?employeeId&startDate&endDate` (duplicate check on comment prefix `[Handyman HM-<id>]`) then `POST /api/timesheets`

## Accounting mapping

One order line per Handyman order, ex VAT: fixed price, else sum of `Amount * CustomerPrice` for registrations plus `Quantity * CustomerPrice` for materials, rounded per line to øre. VAT code is omitted, so ReAI uses the customer default (code 3 domestic). Hours are logged on the order's finish date.

## Caveats

- The API must be published over https by the customer's IT partner, otherwise the Worker cannot reach it.
- `CustomerPrice` has no description in the Swagger; treated as unit price. The preview must be checked.
- `OrderHead.VATRate` is not mapped; orders with other VAT than the ReAI default need the VAT code changed in ReAI.
- Using the invoice customer before the order customer is an assumption.
- Orders over 24 hours cannot be logged as one timesheet entry.

Last verified: 2026-11-28.
