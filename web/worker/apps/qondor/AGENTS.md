# Qondor Invoices to ReAI

Route `/app/qondor/`. Docs pages: `web/content/{nb,en}/web-apps/qondor/index.md`.

Purpose: read unprocessed invoices from the Qondor Invoicing API, stage invoice specifications as ReAI orders, import
invoices Qondor has already numbered with their number, and mark each as processed in Qondor.

## Vendor docs

- API portal (Azure API Management, public reference and mocked responses): https://qondor.developer.azure-api.net/
  (Invoicing v1 (Prod), api id `582afe00affed51354837469`)
- Access: https://help.qondor.com/en/articles/1227269-api-portal-introduction
- Payments flow guide: https://help.qondor.com/en/articles/13513576-technical-integration-guide-processing-payments-with-the-invoice-api
- Overview: https://qondor.com/api-portal

## API version

Invoicing v1 (`https://qondor.azure-api.net/Prod/Invoicing/v1`), the only invoicing version in the portal.

## Auth

Qondor support (support@qondor.com) grants the customer's users a Production subscription; each user copies the
primary key from their profile on the API portal. Header `Ocp-Apim-Subscription-Key`.

## Endpoints

- `GET /Invoice/GetAllUnprocessedInvoices` (no parameters, plain array; only projects created after the office's
  Invoice API start date).
- `GET /Invoice/GetInvoice/{id}` (items[].prices[]: description, quantity, outPriceExVat, vatPercentage,
  totalOutPriceExclVat, totalOutVatAmount, totalVatBaseAmount; referral items excluded by default).
- `PUT /Invoice/SetAsProcessed` with `{ invoiceId, externalReference }` (ReAI order or invoice number).

## Subrequests per action

- Fetch: 1.
- Import one: Qondor 2 (GetInvoice, SetAsProcessed), ReAI order duplicate check 1, VAT codes and invoice settings 2,
  customer lookup 1 to 3, customer create 0 or 1, order create 1, invoice import 0 or 1. At most 11.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/vat-codes?usage=customer_invoice`, `GET /api/invoice-settings`
- `GET /api/customers`, `POST /api/customers`
- `GET /api/orders?externalReference=qondor-invoice-<id>&status=all`, `POST /api/orders`
- `POST /api/invoices/import` (source `qondor`, sourceInstance officeId, externalId, number, issueDate, dueDate,
  accounting `book`, orderId)

## Mapping

- Each price becomes an order line excl. VAT with the ReAI output VAT code for vatPercentage (0 % uses the exempt
  code). If quantity × rounded unit price does not equal the line total, the line is sent as quantity 1 at the total.
- Currency from the invoice (`currency`). Due days from dueDate, else the ReAI default.
- isInvoice false (specification): order only, invoiced later from ReAI. isInvoice true: the same order is imported
  as an invoice with the Qondor invoice number, booked by ReAI.
- Customer matched by Norwegian organisationNumber, emailAddress, then exact name; else created. The recipient
  country is a name in Qondor and is mapped for Nordic countries, Germany and the UK; other countries require the
  customer to exist in ReAI first.

## Left in Qondor (shown, not imported)

Credit notes (type 2), credit card payments (invoiceType 4 to 6), already processed invoices, and lines whose VAT base
differs from the price (margin style VAT), or items that do not add up to the invoice totals.

## Caveats

- Not verified against a live account; field mapping follows the portal's documented response and example.
- Payments are not imported; register them in ReAI (bank reconciliation).
- If an order exists but the invoice import failed, the next click retries the import on that order.

## Vendor contact

support@qondor.com (named for API access on https://help.qondor.com/en/articles/1227269-api-portal-introduction).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
