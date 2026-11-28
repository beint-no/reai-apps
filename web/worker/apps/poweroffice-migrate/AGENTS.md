# PowerOffice Switch

Route `/app/poweroffice-migrate/`. Docs pages: `web/content/{nb,en}/web-apps/poweroffice-migrate/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.poweroffice.net/documentation/authentication
- https://developer.poweroffice.net/documentation/owner-vs-developer
- https://swagger.poweroffice.net/openapispecs/customers.json
- https://swagger.poweroffice.net/openapispecs/suppliers.json
- https://swagger.poweroffice.net/openapispecs/products.json

- Mode: fix
- Calls: POST https://goapi.poweroffice.net/OAuth/Token with Basic base64(applicationKey:clientKey), Ocp-Apim-Subscription-Key and grant_type=client_credentials, then GET /v2/Customers, /v2/Suppliers, /v2/Products with PageNumber/PageSize (Number, Name or FirstName/LastName, OrganizationNumber, EmailAddress, IsArchived; Code, Name, UnitPrice). ReAI: POST /api/customers and /api/suppliers after GET ?organizationNumber= check, POST /api/products {title, variants:[{sku, sellingPrice}]} after GET ?query=sku check. CSV fallback removed. fetchApi now takes {subscriptionKey, applicationKey, clientKey}.
- Hosts in code: `developer.poweroffice.net`, `goapi.poweroffice.net`, `swagger.poweroffice.net`
- Vendor status: Brreg: active, no konkurs/avvikling/slettedato. poweroffice.no and developer.poweroffice.net (API v2, swagger.poweroffice.net) are live.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/products`
- `/api/suppliers`

## Caveats

Application and subscription keys belong to the registered developer. Today the customer must register their own integration with PowerOffice (go-api@poweroffice.no, Visma Developer Terms) to get them. Better: the owner registers ReAI as a PowerOffice developer and stores the application and subscription keys as Worker secrets (shared Env change), so the customer only pastes the client key. Token response field names are not shown in the docs; the module reads the standard OAuth access_token. PowerOffice products carry no VAT code (VAT follows the sales account), so ReAI defaults apply; sellingPrice is sent excluding VAT. web/test/provider-api.test.mjs calls fetchApi({subscriptionKey, apiToken}) and expects a CSV style result; it needs updating (that file currently fails to load anyway because extendago.js no longer exports fetchApi).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
