# Provet Cloud Veterinary Sales Accounting

Route `/app/provet-cloud/`. Docs pages: `web/content/{nb,en}/web-apps/provet-cloud/index.md`.

Fetches issued Provet Cloud invoices for a period and books one balanced ReAI review voucher: clinic payments by type, open client balances and sales by VAT rate.

## Vendor API

- Docs home and access form: https://developers.provetcloud.com/restapi/ (Request Sandbox and API access)
- Reference: https://developers.provetcloud.com/restapi/0.1/ and https://developers.provetcloud.com/restapi/0.1/openapi-schema-01.json
- Auth: https://developers.provetcloud.com/restapi/authentication_oauth2.html
- Billing and ERP sync pattern: https://developers.provetcloud.com/restapi/howto_billing.html, https://developers.provetcloud.com/restapi/howto_erp_accounting.html
- Paging: https://developers.provetcloud.com/restapi/pagination.html
- Changelog and upcoming changes: https://developers.provetcloud.com/restapi/changelog.html, https://developers.provetcloud.com/restapi/upcoming-changes.html

API version: REST API 0.1 (the only version; the changelog lists dated non-breaking releases, latest 2026-11-25, none touching invoice, invoicerow or invoicepayment; the announced breaking changes for 2026-12-15 cover countersale finalize and form_assignment only).

Auth: not self service. The clinic asks Provet via the access form; Provet sets up a client credentials integration whose virtual user needs Financial: Invoices. One `POST https://provetcloud.com/<provet_id>/oauth2/token/` (grant_type=client_credentials, scope=restapi, HTTP Basic client auth) per fetch, then `Authorization: Bearer`. Host restricted to *.provetcloud.com (OpenAPI server variable `domain`).

## Calls

Following the billing guide's sync pattern, one invoice page at a time, then rows and payments of that page in two parallel requests:

- `GET /api/0.1/invoice/?invoice_date__gte=<from>&invoice_date__lt=<to+1>&page_size=200` (follow `next` until null)
- `GET /api/0.1/invoicerow/?invoice__in=<ids of that page>&page_size=1000` (vat_percentage, sum_total)
- `GET /api/0.1/invoicepayment/?invoice__in=<ids>&page_size=1000` (payment_type, paid, status)

Paging: `next` only (count can be stale, per docs); max page_size 1000; invoice__in lists kept to one page of up to 200 IDs as the guide recommends. Rate limits: 60/min on /invoice/, 100/min on payments; 429 shows a wait message with Retry-After.

Subrequests per fetch: 1 token + about 3 per 200 invoices, hard cap 45 Provet pages (then "choose a shorter period"). Book: 3 ReAI calls.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vat-codes` (checks codes 3, 31, 33 are vat_inclusive output codes at 25/15/12 % and 6 is 0 %)
- `GET /api/vouchers?startDate&endDate&includeReversed=true` (duplicate check on "Provet Cloud invoices <from> to <to>")
- `POST /api/manual-vouchers` (rows via `pairVoucherRows`, NOK, dated the last day of the period, review reason)

## Accounting mapping

- Invoices with status 0 (draft) or 99 (voided) and without invoice_number are skipped; statuses 1 to 4 count as issued. Status is filtered client side because the guide says `status__is` while the OpenAPI lists `_status__is`.
- Rows credit sales gross with VAT inclusive codes: 25 % → 3000/3, 15 % → 3010/31, 12 % → 3020/33, 0 % → 3200/6. Credit notes are separate negative invoices and reduce the same lines.
- Payments: 0 card and 7 mobile → 1580, 1 cash → 1900, 3 rounding → 7790, 5 voucher, 8 prepayment and 9 gift card → 2900. Bank, cheque, consolidated invoice, financing, other, credit invoice and insurance claim stay with the open balance on 1570 (invoice totals minus clinic payments).
- Payment status 1 (pending) and 4 (failed) are left out. Cancelled payments stay in: Provet reverses them with a separate negative payment record, so the pair nets to zero.
- Amounts in øre; the voucher is only offered when rows add up to invoice totals.

## Caveats

- Invoice has no currency field; the clinic must use NOK.
- `invoice_date` is a datetime; the date filter is applied by Provet in the organisation's time zone (not documented).
- Payments are taken by invoice, not by payment date, so later payments on an invoice in the period are counted in this period.
- Row `account_number` (the clinic's own GL mapping) is not used; fixed accounts above.

Last verified: 2026-11-28
