# Klarna Reconcile

Route `/app/klarna/`. Docs pages: `web/content/{nb,en}/web-apps/klarna/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.klarna.com/acquirer/klarna/api/settlements/
- https://docs.klarna.com/api/authentication/

- Mode: keep
- Calls: Code unchanged; all host, path, params, auth and fields match the published Settlements API spec. NB/EN docs updated: key comes from the Klarna Partner Portal or merchant support (was Merchant Portal), removed em dashes.
- Hosts in code: `api.klarna.com`
- Vendor status: Brreg: Klarna Norge AS and Klarna Bank AB (NUF 996093093) active. Settlements API documented at docs.klarna.com.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

Only the European host api.klarna.com is used (fine for Norwegian merchants). end_date is sent as the first day of the next month at 00:00:00Z; Klarna recommends an explicit end time, so a payout stamped exactly at midnight could appear in both months (negligible).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
