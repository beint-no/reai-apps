# Accounting Data Export (export)

Route `/app/export/` (handler `handleExport`). Docs pages: `web/content/{nb,en}/web-apps/export/index.md`.

## Purpose

Exports ReAI postings, customer invoices, supplier invoices, customers or products as Excel CSV (UTF-8 BOM, semicolon, formula injection guarded by `safeCsvCell`) or JSON. Calls no third-party API.

## ReAI API

Contract: https://app.reai.no/openapi/public (version v1). All lists are paged (`page`, `pageSize` at most 200, `totalPages`, `hasNext`).

- `GET /api/postings?startDate&endDate` (posting date, inclusive): `PostingRes`. `amount` is company currency, `currencyAmount` + `currencyCode` the transaction currency; both are exported.
- `GET /api/invoices?startDate&endDate` (issue date): `InvoiceOverviewRes` totals, `paidAmount`, `outstanding`, `invoiceCompanyCurrencyAmount`, `creditedInvoiceId`.
- `GET /api/supplier-invoices?startDate&endDate` (invoice date): `SupplierInvoiceListItemRes` (`number`, `date`, `documentType`, `paymentState`). Supplier names come from `GET /api/suppliers?archived=false|true` (the list has only `supplierId`).
- `GET /api/customers?archived=false|true`: ReAI serves active and archived separately; both are read. City and country come from `address`.
- `GET /api/products` (active only): one row per variant.

## Subrequests per action

- Preview: 1 page of 100 records (2 for customers; supplier invoices add the supplier lists). No data is round tripped through the HTML.
- Download: page 1, then the remaining pages 4 at a time. Hard cap 45 subrequests per download (`MAX_SUBREQUESTS`), so at most 8,000 records (`MAX_ROWS`); larger datasets fail after the first page with a clear message, and the preview warns in advance.

## Caveats

- Month granularity only; the period is the calendar month.
- Archived products are not exported.
- Sample preview and sample downloads use API shaped synthetic records run through the same mapping.

Last verified: 2026-11-28.
