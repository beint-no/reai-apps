# Spreadsheet Import

Route `/app/import/`. Docs pages: `web/content/{nb,en}/web-apps/import/index.md`.

Creates products, customers or suppliers in ReAI from a CSV or TSV file (UTF-8 or Windows-1252,
semicolon or comma) with English and Norwegian header matching.

## Vendor API

None. The app reads an uploaded file only and calls no third-party API.

## ReAI API

Contract: https://app.reai.no/openapi/public (local copy checked 2026-11-28).

- `GET /api/{products|customers|suppliers}?archived=false|true&page&pageSize=200`: existing records for
  duplicate checks, active and archived (200 is the documented maximum).
- `GET /api/vat-codes?usage=customer_invoice`: only on products when a row sets a VAT code; the code
  must be one ReAI accepts on sales lines.
- `POST /api/products` (`ProductReq`): `title`, `description`, `brand`, `stockItem` (default true),
  `vatCode`, `revenueAccountCode` (3xxx), `variants[{ sku, sellingPrice, costPrice, barcode }]`.
- `POST /api/customers` (`CreateCustomerReq`): `name` (max 75), `number`, `organizationNumber`
  (Mod11 for Norwegian companies), `privateContact`, `email`, `invoiceEmail`, `phone` (E.164),
  `countryCode`, `addressPart1`, `postalCode`, `city`, `daysUntilDue`, `skipRegistryLookup: true`.
- `POST /api/suppliers` (`CreateSupplierReq`): as customers without invoice fields, plus
  `bankAccountNumber` and `iban`.

## Duplicates

Products match on SKU; customers and suppliers on number, name or email (case insensitive), against
active and archived ReAI records and earlier rows in the file. Matches are skipped, not updated.

## Subrequest budget

Preview: listing pages (active + archived) plus at most one VAT code call. Run: the same plus one
`POST` per ready row. One click spends at most 45 subrequests and creates at most 40 records; the
create cap shrinks by the listing pages used. Very large registers (about 8,000 records or more)
cannot be checked in one click and get a clear error.

## Caveats

- No bulk create endpoint exists, so creates are sequential, one request per row.
- `ProductReq.vatCode` validation uses `usage=customer_invoice`; ReAI still owns final validation and
  rejected rows show ReAI's message in the result report.
- Name based duplicate matching is deliberately on the safe side (two real customers with the same
  name need a number to import both).

Last verified: 2026-11-28.
