# Amendo Z-report Accounting

Route `/app/amendo/`. Docs pages: `web/content/{nb,en}/web-apps/amendo/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api.tellix.no/api/doc
- https://jsapi.apiary.io/apis/tellixprotouch.apib
- https://amendo.no/om-oss/
- https://amendo.no/integrasjoner/

- Mode: api
- Auth: Amendo issues API username, password and API key on request to existing customers (amendo.no/om-oss: 'åpent API på forespørsel'). POST https://api.tellix.no/web/v3/getaccesstoken (form: username, password, apikey) returns a 6-hour token sent as the raw Authorization header (no Bearer).
- Hosts in code: `api.tellix.no`, `jsapi.apiary.io`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. amendo.no live (Copyright AMENDO GROUP AS), sells Amendo POS on Tellix ProTouch.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Amendo's back office runs on the Tellix ProTouch platform; the API host api.tellix.no is not named on any Amendo page (found via bo.tellix.no). GET /zreport/list has only offset/limit (no date filter), so up to 20 pages of 100 are scanned and matched on signDate/cashSettlementDate ('YYYY/MM/DD'). Uses data[].vatTurnover[].turnoverInclVat (sales), returnVatTurnover (subtracted) and paymentMethodTurnover[] (paymentType, amount); 'Kontant' goes to 1900, other types including Faktura to 1580. Gift cards, credit notes and totalRoundOff are not mapped, so such days show a difference and cannot be booked. Sends the blueprint's Source header ('ReAI Apps'). Error 104 'WebShop Integration module is disabled' suggests a module may need enabling. No live verification. support@amendo.no is the fallback.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
