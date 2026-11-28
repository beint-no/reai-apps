# Front Systems POS

Route `/app/front-systems/`. Docs pages: `web/content/{nb,en}/web-apps/front-systems/index.md`.

Books one day of Front Systems POS settlements as one balanced ReAI review voucher: payments per payment type on the debit side, sales per VAT rate on the credit side.

## Vendor docs

- Quickstart and auth: https://developer.frontsystems.com/quickstart
- Operation reference (REST API V2, PossettlementV2): https://developer.frontsystems.com/api-details#api=front-systems-webshop-api-V2&operation=62ff835221446f431685d5f0
- Portal API list, operations and schema (machine readable): https://developer.frontsystems.com/developer/apis?api-version=2022-04-01-preview
- Backend Swagger with the full SettlementDto: https://webapi.frontsystems.no/swagger/v1/swagger.json
- No public changelog or deprecation page exists.

## API version

REST API `V2` (portal id `front-systems-webshop-api-V2`, path `restapi/V2`), the newest version in the portal's version set; V1 (`webshop`) and the older `Possettlement` operation remain listed. Gateway host `frontsystemsapis.frontsystems.no` (portal hostnames endpoint).

## Auth

Two headers per request: `Ocp-Apim-Subscription-Key` (customer signs up at developer.frontsystems.com and copies the key from the profile) and `x-api-key` (Front Systems Portal, Admin, Integration users, Company scope).

## Endpoints

- `GET /restapi/V2/api/Possettlementv2?date=YYYY-MM-DD&includePaymentTypes=true&offset&limit=100[&storeId]`

Fields used: `Currency`, `BatchNumber`/`SettlementId`, `NetTotal`, `GrandTotal`, `PaymentTypes[].{Type, SubType, Amount, AccountNumber}` (fallback `SAFT_ZReport.reportPayments[].{paymentType, paymentAmnt, accID}`), `SAFT_ZReport.reportCashSalesVat[].{vatPerc, cashSaleAmnt, vatAmnt, accID}`.

## Paging, limits, budget

Offset paging with `limit=100` until a short page, capped at 10 pages. Maximum `limit` and rate limits are not documented. Fetch: 1 subrequest per 100 settlements (max 10). Book: 3 ReAI subrequests (`/api/vouchers` duplicate check, `/api/vat-codes`, `/api/manual-vouchers`).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true` (duplicate check on description `Front Systems <ref> <date>`)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers` with `reviewReason`, rows from `pairVoucherRows`

## Accounting mapping

- Payments: `AccountNumber` from Front Systems when 4 digits, otherwise `1900` for cash and `1580` for other types; VAT code `0`.
- Sales: `accID` when 4 digits, otherwise `3000`/`3010`/`3020` for 25/15/12 % and `3100` for 0 %; posted VAT inclusive with the ReAI output VAT code for the rate (`vat_inclusive`, not reverse charge).
- NOK only; another `Currency` stops the fetch.

## Caveats

- The portal example is PascalCase while the backend Swagger is camelCase; both are read. The response is a single object in the example and a list in practice; both are read.
- Whether `cashSaleAmnt` is net or gross is not stated; its sum is compared with `NetTotal` and `GrandTotal`.
- Tips (`reportTip`), withdrawals and deposits are not mapped. Gift card, invoice and rounding payment types without an `AccountNumber` fall back to `1580`; the customer should set ledger accounts on payment types in Front Systems.
- If payments and sales differ the voucher is blocked as unbalanced.

Last verified: 2026-11-28.
