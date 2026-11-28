# Nexi Checkout Reconcile

Route `/app/nets/`. Docs pages: `web/content/{nb,en}/web-apps/nets/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.nexigroup.com/nexi-checkout/en-EU/api/reporting-v1/
- https://developer.nexigroup.com/nexi-checkout/en-EU/api/

- Mode: rename
- Calls: Brand Nexi Checkout (formerly Nets Easy). Exported fetchApi(fields, start, end, fetchImpl) calls GET {api|test.api}.dibspayment.eu/report/v1/payouts with fromDate, toDate, zero-based pageNumber, pageSize=100, merchantNumber only when entered; reads documented id, reference, date, currency, amount, fees, chargedAmount, refundedAmount (minor units) and pages on numberOfPayouts. Fees column shown; Dintero card removed. No ReAI writes (only existing shared reconcile helpers). Docs NB/EN rewritten with portal path Company → Integration.
- Hosts in code: `api.dibspayment.eu`, `developer.nexigroup.com`, `test.api.dibspayment.eu`
- Vendor status: Nets Easy is sold today as Nexi Checkout; developer.nexigroup.com/nexi-checkout documents the live Reporting API (HTTP 200). Brreg: NETS DENMARK A/S not bankrupt, not dissolving, no deletion date.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

Live base address taken from the Checkout API environments section (api.dibspayment.eu); the reporting page itself only shows the test host. Portal menu path Company → Integration comes from integration guides, not a page I could fetch (access-your-integration-keys returned 404). Slug stays 'nets'; coordinator may want a nexi-checkout alias. Not covered by web/test/provider-api.test.mjs.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
