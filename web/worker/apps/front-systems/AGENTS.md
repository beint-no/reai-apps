# Front Systems POS

Route `/app/front-systems/`. Docs pages: `web/content/{nb,en}/web-apps/front-systems/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.frontsystems.com/quickstart
- https://developer.frontsystems.com/api-details#api=front-systems-webshop-api-V2&operation=62ff835221446f431685d5f0
- https://webapi.frontsystems.no/swagger/v1/swagger.json

- Mode: fix
- Calls: GET https://frontsystemsapis.frontsystems.no/restapi/V2/api/Possettlementv2?date&includePaymentTypes=true&offset&limit[&storeId] with Ocp-Apim-Subscription-Key and x-api-key. Payments from PaymentTypes (amount, accountNumber) or SAFT_ZReport.reportPayments; sales per VAT from SAFT_ZReport.reportCashSalesVat (vatPerc, cashSaleAmnt, vatAmnt, accID). Sales VAT inclusive with ReAI output VAT codes from GET /api/vat-codes, pairVoucherRows, duplicate check. NOK only.
- Hosts in code: `developer.frontsystems.com`, `frontsystemsapis.frontsystems.no`, `webapi.frontsystems.no`
- Vendor status: Brreg: no flags, 19 employees. frontsystems.no redirects to egsoftware.com/global/retail-wholesale/front-systems; product still sold as Front Systems.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

The developer portal example shows one PascalCase object while the backend Swagger shows camelCase; both casings and array/object responses are accepted. Whether cashSaleAmnt is net or gross is not stated, so it is compared with NetTotal and GrandTotal. Tips and gift card lines are not mapped; if they make payments and sales differ the voucher is blocked as unbalanced. A subscription key requires signing up on the developer portal (retailer subscription).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
