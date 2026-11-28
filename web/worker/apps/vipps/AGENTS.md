# Vipps Reconcile

Route `/app/vipps/`. Docs pages: `web/content/{nb,en}/web-apps/vipps/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.vippsmobilepay.com/docs/APIs/report-api/api-guide/fetching-report-data/
- https://developer.vippsmobilepay.com/docs/APIs/report-api/api-guide/overview/
- https://developer.vippsmobilepay.com/docs/knowledge-base/api-keys/
- https://developer.vippsmobilepay.com/api/report

- Mode: keep
- Calls: No code change. NB/EN docs rewritten with the real key path (portal.vippsmobilepay.com → For developers → Production → Show keys), note that Vipps number sales units cannot use Report API, em dashes and fee claims removed.
- Hosts in code: `api.vipps.no`
- Vendor status: Brreg 918713867 VIPPS MOBILEPAY AS: konkurs false, underAvvikling false, tvangsavvikling false, no slettedato. Report API documented at developer.vippsmobilepay.com.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

The guide does not state the sign of payout-scheduled amounts; the module assumes negative (payout reduces the balance). Calls one funds request per ledger per day of the month.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
