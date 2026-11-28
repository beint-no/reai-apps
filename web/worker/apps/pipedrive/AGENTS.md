# Pipedrive CRM Sync

Route `/app/pipedrive/`. Docs pages: `web/content/{nb,en}/web-apps/pipedrive/index.md`.
Handler export: `handlePipedrive`.

Turns won Pipedrive deals into draft ReAI orders and creates missing ReAI customers from the
deals' organizations.

## Vendor docs

- Deals reference: https://developers.pipedrive.com/docs/api/v1/Deals#getDeals
- Organizations reference: https://developers.pipedrive.com/docs/api/v1/Organizations#getOrganizations
- API v2 OpenAPI spec: https://developers.pipedrive.com/docs/api/v1/openapi-v2.yaml
- Auth (personal API token): https://pipedrive.readme.io/docs/how-to-find-the-api-token
- Rate limits (token based, `x-token-cost` per endpoint): https://pipedrive.readme.io/docs/core-api-concepts-rate-limiting
- Changelog: https://developers.pipedrive.com/changelog (v1 list endpoints for deals and
  organizations are deprecated: https://developers.pipedrive.com/changelog/post/deprecated-apiv1-endpoints-become-out-of-support)

## API version and auth

- API v2 (`https://api.pipedrive.com/api/v2`, spec 2.0.0), the current version for deals and
  organizations; the v1 equivalents are out of support.
- Customer copies the personal API token under Company settings → Personal preferences → API.
  Header: `x-api-token: <token>` (v2 `api_key` scheme).

## Endpoints

- `GET /api/v2/deals?status=won&updated_since=<from>T00:00:00Z&sort_by=update_time&sort_direction=desc&limit=500`,
  cursor paging via `additional_data.next_cursor`, at most 10 pages (then an error asks for a
  later date). Deals are kept when `local_won_date` (fallback `won_time`) is on or after the
  chosen date and `value > 0`. Fields: `id`, `title`, `value`, `currency`, `org_id`,
  `local_won_date`, `won_time`. Token cost 10 per page.
- `GET /api/v2/organizations?ids=<up to 100>&limit=500` for the deals' organizations only, in
  parallel chunks (at most 10). Fields: `id`, `name`, `address.value`, `address.country`.
- 429 is surfaced by `fetchJson` as an HTTP error; the scan stays far below the daily token budget.

## Subrequests per action

- Scan: deal pages (usually 1) + organization chunks (usually 1) + ReAI customer pages
  (`GET /api/customers`, 200 per page, once). Typically 3.
- Create customer: 1 `GET /api/customers?organizationNumber=` + 1 `POST /api/customers`.
- Stage order: 1 `GET /api/orders?externalReference=` + 1 `POST /api/orders`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers` (name match), `GET /api/customers?organizationNumber=` (duplicate check), `POST /api/customers`
- `GET /api/orders?externalReference=pipedrive-deal-<id>` (duplicate check), `POST /api/orders`

## Mapping

- Organization → company customer (`countryCode` NO, org number typed by the user, Mod11
  checked, `skipRegistryLookup`).
- Won deal → draft order: one line `itemName = title`, `quantity 1`, `unitPrice = value`,
  `currencyCode` from the deal, `issueDate`/`orderDate` = won date, `daysUntilDue` 14,
  `externalReference pipedrive-deal-<id>`.

## Caveats

- Pipedrive does not say whether a deal value includes VAT; the order line gets ReAI's default
  VAT code and the docs ask the user to check it. Deal products (`GET /api/v2/deals/products`)
  are not used.
- Customer matching is by exact name; Pipedrive organizations have no standard org number field.
- Organizations without won deals in the period are not listed.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
