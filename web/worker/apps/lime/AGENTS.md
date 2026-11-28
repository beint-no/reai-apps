# Lime CRM

Route `/app/lime/`. Docs pages: `web/content/{nb,en}/web-apps/lime/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.lime-crm.com/integration/rest-apis/start
- http://static.lime-crm.com/crm-api-docs/spec/limeobject

- Mode: fix
- Calls: GET <application>/api/v1/limeobject/deal/?dealstatus=agreement&min-closeddate=<date>&_sort=-closeddate&_limit=50 and GET /company/{id}/ for each referenced company, header x-api-key; reads documented fields id, name, company, value, closeddate and company name, registrationno, visitingcity; accepts the HAL _embedded.limeobjects envelope or a plain array. Customers matched by org.nr or name; POST /api/customers unchanged; GET /api/orders?externalReference=lime-<id>&status=all before POST /api/orders. Docs rewritten with the LISA API user steps.
- Hosts in code: `customer.lime-crm.com`, `docs.lime-crm.com`
- Vendor status: Brreg: Lime Technologies Norway AS active (www.lime-technologies.no). Lime CRM sold; docs.lime-crm.com live.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`

## Caveats

Lime CRM data models are per application; the example spec documents the standard base solution, and each install has its own interactive docs at /api/v1/docs/. The example spec describes list responses as arrays; live installs return HAL with _embedded.limeobjects (handled both). Only the first 50 won deals since the chosen date are read (no next-link paging). Order lines use the default customer VAT code.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
