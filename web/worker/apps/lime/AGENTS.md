# Lime CRM

Route `/app/lime/`. Docs pages: `web/content/{nb,en}/web-apps/lime/index.md`.

Reads won Lime CRM deals and their companies, lets the user create missing ReAI customers and stages each won deal
as one ReAI order.

## Vendor API

- Overview, API users and rate limits: https://docs.lime-crm.com/integration/rest-apis/start
- Limeobject API reference (example spec for the standard data model): http://static.lime-crm.com/crm-api-docs/spec/limeobject
- Each application has its own interactive docs for its data model: `<application>/api/v1/docs/`
- No public changelog or deprecation notices found.

Version: Limeobject API `v1` (`<application>/api/v1/limeobject/`), the only published version. The Query API exists
for large reads but its request format is not publicly documented, so it is not used.

Auth: an administrator creates a user of type API in Lime CRM Server Administration (LISA) and generates the API key
(shown once; a new key invalidates the old one). Sent as header `x-api-key`. Permissions follow the user's groups.

## Endpoints

- `GET /deal/?dealstatus=agreement&min-closeddate=<date>&_sort=-closeddate&_limit=50&_embed=company`; further pages by
  following the HAL `_links.next.href` (must stay on the entered origin), at most 6 pages (300 deals).
- `GET /company/{id}/` only for companies the deal list did not embed, 6 in parallel.
- Deal fields: `id`, `name`, `company`, `value`, `closeddate`. Company fields: `name`, `registrationno`, `visitingcity`.
- Rate limit (Lime CRM Cloud): 3000 requests per 5 minutes per IP.

Subrequest budget: scan = deal pages (1 to 6) + fallback company GETs (capped so Lime calls stay at or under 40) +
ReAI customer pages (200 per page). Create customer = 2. Stage order = 2.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers` (all pages, once per scan; `?organizationNumber=` before create)
- `POST /api/customers` (`name`, `organizationNumber`, `countryCode`, `privateContact`, `skipRegistryLookup`)
- `GET /api/orders?externalReference=lime-<id>&status=all` before `POST /api/orders`

## Mapping

Company → ReAI customer, matched by organization number, then by name. Won deal → ReAI order with one line
(`itemName` = deal name, `unitPrice` = deal value excluding VAT, default customer VAT code), currency NOK,
`externalReference` `lime-<deal id>`. `closeddate` with a time zone becomes its Europe/Oslo day.

## Caveats

- Data models are per application; customized installs may rename `registrationno`, `value` or `dealstatus`.
- The embedded company key in HAL `_embedded` is not shown in the public spec; the code reads `relation_company` or
  `company` and falls back to `GET /company/{id}/`, so a different key only costs extra requests.
- The base data model has no deal currency, so orders are NOK.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
