# HubSpot CRM Sync

Route `/app/hubspot/`. Docs pages: `web/content/{nb,en}/web-apps/hubspot/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.hubspot.com/docs/api-reference/latest/crm/objects/companies/get-companies
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys
- https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview
- https://developers.hubspot.com/changelog/legacy-private-app-creation-sunset

- Mode: fix
- Calls: GET https://api.hubapi.com/crm/objects/2026-09/companies with limit=100, archived=false, standard properties name/domain/phone/address/zip/city/country plus an optional user named custom org.nr property, following paging.next.after. Auth is Bearer with a service key (Development → Keys → Service keys) or an existing private app token, scope crm.objects.companies.read. ReAI side unchanged (GET /api/customers, POST /api/customers verified against the contract). fetchHubSpotCompanies is now exported for tests.
- Hosts in code: `api.hubapi.com`, `developers.hubspot.com`
- Vendor status: HubSpot is a live listed CRM vendor; developer docs current (API version 2026-09, service keys public beta since 2026-02-10).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`

## Caveats

Without a custom org.nr property every Norwegian company shows as 'needs org.nr' and the user types it inline. Paging capped at 50 pages (5,000 companies).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
