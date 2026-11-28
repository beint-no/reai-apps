# Pipedrive CRM Sync

Route `/app/pipedrive/`. Docs pages: `web/content/{nb,en}/web-apps/pipedrive/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.pipedrive.com/docs/api/v1/Deals#getDeals
- https://developers.pipedrive.com/docs/api/v1/Organizations#getOrganizations
- https://developers.pipedrive.com/docs/api/v1/openapi-v2.yaml
- https://developers.pipedrive.com/changelog/post/deprecated-apiv1-endpoints-become-out-of-support
- https://pipedrive.readme.io/docs/how-to-find-the-api-token

- Mode: fix
- Calls: GET https://api.pipedrive.com/api/v2/organizations and /api/v2/deals?status=won&sort_by=update_time&sort_direction=desc with x-api-token header, cursor pagination via additional_data.next_cursor (limit 500, bounded). Deal organization resolved from org_id against the organizations list; won date from local_won_date/won_time; address from address.value. Before POST /api/orders the module now checks GET /api/orders?externalReference=pipedrive-deal-<id> and links to an existing order. Docs rewritten with the real token path (Company settings → Personal preferences → API).
- Hosts in code: `api.pipedrive.com`, `developers.pipedrive.com`, `pipedrive.readme.io`
- Vendor status: pipedrive.com live and sold; developer docs and v2 OpenAPI current (developers.pipedrive.com).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`

## Caveats

Deal value is sent as order unitPrice with ReAI's default VAT code; Pipedrive does not say whether the value includes VAT, so the docs ask the user to check VAT on the order. Customer matching stays name based (Pipedrive organizations have no standard org number field).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
