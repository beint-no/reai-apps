# PowerOffice Switch

Route `/app/poweroffice-migrate/`. Docs pages: `web/content/{nb,en}/web-apps/poweroffice-migrate/index.md`.

Moves active customers, suppliers and products from PowerOffice Go into ReAI, one row per click.

## Vendor docs

- Authentication: https://developer.poweroffice.net/documentation/authentication
- Requests (paging, Fields, throttling): https://developer.poweroffice.net/documentation/requests
- Owner vs developer keys: https://developer.poweroffice.net/documentation/owner-vs-developer
- v1 to v2 transition: https://developer.poweroffice.net/documentation/from-v1-to-v2
- Customers spec: https://swagger.poweroffice.net/openapispecs/customers.json
- Suppliers spec: https://swagger.poweroffice.net/openapispecs/suppliers.json
- Products spec: https://swagger.poweroffice.net/openapispecs/products.json

## API version and auth

- Go API v2 (`https://goapi.poweroffice.net/v2`), the current API; v1 is legacy.
- Application key and subscription key belong to a registered developer integration
  (go-api@poweroffice.no); the client key appears when the integration is activated in Go.
- One token exchange per fetch: `POST https://goapi.poweroffice.net/OAuth/Token` with
  `Authorization: Basic base64(applicationKey:clientKey)`, `Ocp-Apim-Subscription-Key`,
  `grant_type=client_credentials` (token lasts 20 minutes). API calls send `Authorization: Bearer`
  and `Ocp-Apim-Subscription-Key`.

## Endpoints

- `GET /v2/Customers?Fields=...&PageNumber=&PageSize=5000`: `Number`, `Name`, `FirstName`,
  `LastName`, `IsPerson`, `IsArchived`, `IsActive`, `OrganizationNumber`, `EmailAddress`,
  `InvoiceEmailAddress`, `PhoneNumber`, `MailAddress` (`AddressLine1/2`, `ZipCode`, `City`, `CountryCode`).
- `GET /v2/Suppliers` with the same fields except `InvoiceEmailAddress`.
- `GET /v2/Products?isArchived=false&Fields=Id,Code,Name,UnitPrice,IsArchived`.
- The three lists are read in parallel. 5000 is the default page size (max 20 000); a page with
  fewer rows ends paging. At most 2000 rows per kind are listed, with a warning when capped.
- Throttling: 10 requests per second per subscription key, 429 otherwise.

## Subrequests per action

- Fetch: 1 token + 3 lists (one page each up to 5000 rows).
- Import one row: 1 duplicate check + 1 create.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers` / `GET /api/suppliers` with `organizationNumber` (or `name`, exact match
  checked locally) before `POST /api/customers` / `POST /api/suppliers`.
- `GET /api/products?query=<sku>` (exact SKU match) before `POST /api/products`.

## Mapping

- Contact → `name`, `number` (PowerOffice number), `organizationNumber` (Norwegian, Mod11
  checked, companies only), `email`, `invoiceEmail` (customers, when it differs), `phone`
  (E.164 only), address when line 1 and city exist, `countryCode` from the address (default NO),
  `privateContact` from `IsPerson`. Archived or inactive contacts are skipped.
- Product → `title`, one variant with `sku` = `Code` and `sellingPrice` = `UnitPrice` excluding VAT.

## Caveats

- The customer must register their own PowerOffice integration today. Better: ReAI registers
  as a PowerOffice developer and stores the application and subscription keys as Worker
  secrets (shared Env change), so the customer only pastes the client key.
- Token response field names are not documented; the standard OAuth `access_token` is read.
- PowerOffice products carry no VAT code (VAT follows the sales account), so ReAI defaults apply.
- Opening balances are out of scope; the SAF-T tool handles them.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
