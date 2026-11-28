# SuperOffice

Route `/app/superoffice/`. Docs pages: `web/content/{nb,en}/web-apps/superoffice/index.md`.

Stages sold SuperOffice CRM sales as ReAI orders for invoicing.

## Vendor docs

- Reference: https://docs.superoffice.com/en/api/reference/restful/rest/sale/get-all.md
- Columns: https://docs.superoffice.com/en/api/archive-providers/reference/findsale.md
- OData options: https://docs.superoffice.com/en/api/search/odata/index.md
- Sale status enum: https://docs.superoffice.com/en/database/tables/enums/salestatus.md
- Auth: https://docs.superoffice.com/en/api/authentication/online/index.md
- App registration: https://docs.superoffice.com/en/developer-portal/getting-started/quickstart.md
- Release notes: https://docs.superoffice.com/release-notes/12/index.md

## API version

REST Web API `v1` (`{tenant}/api/v1/...`), the only REST version; no sunset announced.

## Auth

Customer registers a custom app in the SuperOffice developer portal (tenant needs Development Tools licence
or CRM Suite Core), signs in and pastes the web API URL (`https://online2.superoffice.com/Cust12345/api`)
and the OAuth access token. Header `Authorization: Bearer <token>`. Basic auth is not allowed online. Tokens
last one hour. Never stored.

## Endpoints

`GET {webApiUrl}/v1/Sale` with
`$select=saleId,heading,amount,currency,date,contact/name,contact/orgnr`,
`$filter=saleStatus equals 2 and date between ('from','to')` (Sold = 2), `$orderBy=date,saleId`, `$top=500`,
`$skip=n*500`. Paging stops on a short page; more than 10 pages (5,000 sales) is an error asking for a shorter
range. `odata.nextLink` is not used because the docs do not say when it is returned.

## Budget

- Fetch: 1 subrequest per 500 sales, at most 10.
- Stage one sale: `GET /api/orders?externalReference` (1), `GET /api/customers` by organization number and/or
  name (1 to 2), `POST /api/customers` when new (0 to 1), `POST /api/orders` (1). At most 5. `/api/vat-codes`
  is fetched only if a line has a VAT rate, which SuperOffice sales never have.
- No rate limit is documented for CRM Online; no retry logic.

## ReAI endpoints

`GET /api/orders` (externalReference), `GET/POST /api/customers`, `GET /api/vat-codes` (unused today),
`POST /api/orders`.

## Mapping

- One order line per sale: heading, quantity 1, `amount` as unit price excl. VAT, ReAI default VAT code.
- Currency from the sale's `currency` column; a sale without a three letter ISO code is shown but cannot be
  staged (clear error).
- Customer: exact organization number match, else exact case-insensitive name match (the ReAI name filter is a
  keyword search), else a new company customer with the validated org nr.
- `externalReference = superoffice-<saleId>` prevents staging twice.

## Caveats

- Weak customer path: an access token requires a registered app and a licence; tokens expire after one hour.
- Assumes `amount` is the sale total excl. VAT and that `currency` returns the currency list name (normally the
  ISO code). Not tested against a live tenant.
- `num()` reads amounts; a locale formatted string such as `1,450.00` would parse wrong. SLIM mode is expected
  to return raw numbers.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
