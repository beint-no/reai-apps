# Upsales Won Orders to ReAI

Route `/app/upsales/`. Docs pages: `web/content/{nb,en}/web-apps/upsales/index.md`.

Purpose: turn won Upsales orders (probability 100) dated in a period into draft ReAI orders with their order rows,
and create the missing ReAI customers from the Upsales companies.

## Vendor docs

- API reference (Postman documenter): https://api.upsales.com/
  (collection JSON: https://api.upsales.com/api/collections/4421023/RW87rVf1?segregateAuth=true&versionTag=latest)
- API keys: https://support.upsales.com/hc/en-us/articles/360010164973
- Changelog: "API Documentation Changelog" section on https://api.upsales.com/ (latest entry 2026-09-02).

## API version and auth

- API v2 (`https://integration.upsales.com/api/v2`), the version the documentation describes.
- The API product is activated under Settings → Account → Billing portal → Products. An admin then creates a key
  under Settings → Account → Security → API keys. The key is sent as the `token` query parameter, as in every
  documented request, with `Content-Type: application/json`.
- Free up to 99 999 calls per day; rate limits 200 per 10 seconds, 6 000 per 10 minutes, 20 000 per hour.

## Endpoints

- `GET /orders?token=&probability=100&date=gte:<from>&sort=id&limit=2000&offset=<n>` (limit max 2000, offset paging,
  sort on id as the docs advise), up to 3 pages; `metadata.total` ends paging. Orders after the end date, without
  value or not at probability 100 are dropped locally. Fields: `id`, `description`, `date`, `probability`, `currency`,
  `value`, `client.id`, `client.name`, `orderRow[].quantity`, `orderRow[].price` (net price), `orderRow[].product.name`.
- `GET /accounts?token=&id=eq:<id,id,...>&limit=100` (documented multiple value filter), chunks of 100 ids, at most
  500 companies. Fields: `name`, `orgNo` (Norwegian org. no. checked with Mod11), `mailAddress` (fallback
  `addresses[0]`) `address`, `zipcode`, `city`, `country` (used only when it is an ISO alpha-2 code).

## Subrequests per action

- Fetch: 1 to 3 order pages + 1 to 5 account chunks + ReAI customer pages (usually 1). Typically 3, at most 11.
- Create customer: optional `GET /api/customers?organizationNumber=` + `POST /api/customers`.
- Stage order: `GET /api/orders?externalReference=upsales-order-<id>` + `POST /api/orders`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers` (match by organization number, then exact name), `GET /api/customers?organizationNumber=`,
  `POST /api/customers` (`name`, `countryCode`, `privateContact: false`, `skipRegistryLookup`, `organizationNumber`,
  `addressPart1`, `postalCode`, `city`)
- `GET /api/orders?externalReference=`, `POST /api/orders` (`customerId`, `currencyCode` from the order,
  `daysUntilDue` 14, `issueDate`/`orderDate` = order date, `externalReference`, `comment`, `orderLines` with
  `itemName`, `quantity`, `unitPrice`)

## Mapping

- Each order row becomes an order line (`product.name`, `quantity`, `price`) when the rows add up to `value`
  within 0.005. Otherwise (bundles, discounts the docs do not explain) the order becomes one line with `value`.
- Prices are taken as excluding VAT; ReAI applies the customer's default VAT code.

## Caveats

- No live verification (no Upsales account). Field names come from the documented property list and examples.
- The documented example has rows that do not add up to `value`, hence the fallback above.
- Whether two filters on the same field can be combined is not documented, so only `date=gte:` is sent.
- Company country is a free value in the examples; non ISO values fall back to NO.
- The order and company JSON travel in hidden form fields between preview and staging (browser only).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
