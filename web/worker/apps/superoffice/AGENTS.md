# SuperOffice

Route `/app/superoffice/`. Docs pages: `web/content/{nb,en}/web-apps/superoffice/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.superoffice.com/en/api/reference/restful/rest/sale/get-all.md
- https://docs.superoffice.com/en/api/archive-providers/reference/findsale.md
- https://docs.superoffice.com/en/api/search/odata/index.md
- https://docs.superoffice.com/en/api/search/odata/lists.md
- https://docs.superoffice.com/en/database/tables/enums/salestatus.md
- https://docs.superoffice.com/en/api/authentication/online/index.md
- https://docs.superoffice.com/en/developer-portal/getting-started/quickstart.md

- Mode: fix
- Calls: GET {web API URL}/v1/Sale with OData $select=saleId,heading,amount,currency,date,contact/name,contact/orgnr, $filter=saleStatus equals 2 and date between ('from','to'), $orderBy=date, $top=500, Bearer token; follows odata.nextLink on the same origin. Each sold sale can be staged as a ReAI order (duplicate check by externalReference, customer by organizationNumber then name or created as company customer with validated org nr).
- Hosts in code: `docs.superoffice.com`, `online2.superoffice.com`
- Vendor status: Brreg 956753104 SUPEROFFICE AS: konkurs false, underAvvikling false, tvangsavvikling false, no slettedato. docs.superoffice.com current (release notes 12).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/vat-codes`

## Caveats

Weak customer path: CRM Online accepts only OAuth tokens from an app registered in the SuperOffice developer portal; a custom app needs the Development Tools licence or CRM Suite Core, and tokens last one hour. No documented export alternative exists. Coordinator may prefer remove if a pasted token is considered unusable for customers. Not tested against a live tenant.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
