# Finago Office Switch (24SevenOffice)

Route `/app/24sevenoffice-migrate/`. Docs pages: `web/content/{nb,en}/web-apps/24sevenoffice-migrate/index.md`.
Moves customers, suppliers and products from Finago Office (formerly 24SevenOffice) into ReAI, one row per click.

## Vendor docs

- Reference and topics (get started, auth, scopes, rate limiting, versioning): https://rest-api.developer.24sevenoffice.com/doc/v1/
- OpenAPI: https://rest-api.developer.24sevenoffice.com/doc/v1.json (spec version 0.63.2 on 2026-11-28)
- Access token: https://rest-api.developer.24sevenoffice.com/doc/v1/topic/topic-get-access-token
- Customers: https://rest-api.developer.24sevenoffice.com/doc/v1/operation/operation-getcustomers
- Products: https://rest-api.developer.24sevenoffice.com/doc/v1/group/endpoint-products
- Get started: https://finago.no/developer/rest-api-get-started
- Changelog: none published; versions are announced in the reference (Versioning topic).

## API version

REST API `v1` (`https://rest.api.24sevenoffice.com/v1`), the only public version. The legacy SOAP API is not used.

## Auth

OAuth 2.0 client credentials: `POST https://login.24sevenoffice.com/oauth/token` (form body `grant_type=client_credentials`,
`audience=https://api.24sevenoffice.com`, `client_id`, `client_secret`, `login_organization`), then `Authorization: Bearer`.
The customer requests API access from Finago (form linked in Get started), creates an application under Developer (Utvikler),
adds read scopes for customers and products, and connects it under Administration → Integrations → Connect Application.
`login_organization` is the Finago Client ID: the number before `@voucher.24sevenoffice.com` under Administration →
Settings → Retrieval or in Accounting → Manage vouchers. One token exchange per fetch.

## Endpoints used

- `GET /customers?limit=100` (documented maximum 100), following the `Link` `rel="next"` header. Fields: id, name, person,
  isCompany, isSupplier, organizationNumber, email.contact/billing, phone, mobilePhone, address.postal/visit
  (street, postalCode, postalArea, countryCode). Suppliers are customers with `isSupplier`.
- `GET /products?page=1&limit=100`, following `Link` `rel="next"` (falls back to `page+1` on a full page without Link).
  Fields: id, number, name, status, salesPrice, costPrice, ean.

## Budget

1 token + up to 20 customer pages + up to 20 product pages, customers and products read in parallel; at most 2,000 records.
A typical company (under 500 customers and products) uses about 7 subrequests. Import: 1 duplicate lookup + 1 create per row.
Rate limits are not published; a `429` shows a wait message.

## ReAI API

- `GET /api/customers` / `GET /api/suppliers` with `organizationNumber` (exact), else `name=<number>` with an exact `number` match.
- `POST /api/customers` / `POST /api/suppliers` (name ≤ 75, number, organizationNumber, email, invoiceEmail, phone, addressPart1,
  postalCode, city, countryCode, privateContact).
- `GET /api/products?query=<sku>` with exact variant SKU match, then `POST /api/products` (title, variants[sku, sellingPrice, costPrice, barcode]).

## Mapping

Customer number = Finago customer id; private persons (`isCompany: false`) become private contacts without an organization number.
Products use the product number (or id) as SKU and salesPrice excluding VAT; inactive products are skipped. VAT code and revenue
account are ReAI defaults. Opening balances go through the SAF-T tool.

## Caveats

- Access needs Finago approval of the request form, which can take time.
- `countryCode` on addresses appears in the vendor example but not in the AddressBasic schema; missing values default to `NO`.
- Product `limit` has no documented maximum; 100 is used.
- Slug keeps `24sevenoffice` for URL stability.

## Rules

- Use only documented endpoints, auth, parameters and fields on the newest API version, with server-side paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
