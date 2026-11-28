# Finago Office Switch

Route `/app/24sevenoffice-migrate/`. Docs pages: `web/content/{nb,en}/web-apps/24sevenoffice-migrate/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://rest-api.developer.24sevenoffice.com/doc/v1/authentication
- https://rest-api.developer.24sevenoffice.com/doc/v1/topic/topic-get-access-token
- https://rest-api.developer.24sevenoffice.com/doc/v1.json
- https://finago.no/developer/rest-api-get-started

- Mode: rename
- Calls: Renamed to Finago Office (24SevenOffice) in title, docs and icon. POST https://login.24sevenoffice.com/oauth/token (grant_type=client_credentials, audience=https://api.24sevenoffice.com, client_id, client_secret, login_organization), then GET https://rest.api.24sevenoffice.com/v1/customers?limit=100 following the Link rel=next header (id, name, person.firstName/lastName, isSupplier, organizationNumber, email.contact/billing; suppliers are customers with isSupplier) and GET /v1/products?page&limit (number, name, salesPrice, status). ReAI side same as poweroffice-migrate. CSV fallback removed. fetchApi now takes {clientId, clientSecret, organizationId}.
- Hosts in code: `api.24sevenoffice.com`, `login.24sevenoffice.com`, `rest-api.developer.24sevenoffice.com`, `rest.api.24sevenoffice.com`
- Vendor status: Brreg: both entities active. 24sevenoffice.com redirects to finago.no, which offers 'Finago Office' (login still at app.24sevenoffice.com). Accountor Software, 24SevenOffice and Heeros merged under the Finago brand (press release 13 November 2025). The REST API docs now call the product Finago Office.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/products`
- `/api/suppliers`

## Caveats

The customer needs the Developer admin panel enabled by Finago (application form, review can take weeks), then creates and connects its own application. Slug and file names keep '24sevenoffice' for URL stability; the coordinator may want a new slug and redirect. Exact Norwegian menu labels for Administration and Integrations are not documented; the docs use the documented English labels plus 'Utvikler'. web/test/provider-api.test.mjs calls fetchApi({apiToken}) and needs updating.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
