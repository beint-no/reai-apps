# Svea Checkout Settlement Reconcile

Route `/app/svea/`. Docs pages: `web/content/{nb,en}/web-apps/svea/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://paymentsdocs.svea.com/docs/manage-order/reports/
- https://paymentsdocs.svea.com/docs/getting-started/authentication/
- https://paymentsdocs.svea.com/docs/getting-started/before-you-start/

- Mode: api
- Auth: Checkout merchant ID + secret key issued by Svea with the Svea Checkout agreement (no self-service portal path documented; ask Svea). Reconciliation reports must be activated by Svea. Headers per docs: Timestamp: 'yyyy-MM-dd HH:mm:ss' UTC and Authorization: 'Svea ' + base64(merchantId + ':' + UPPER(hex(SHA512(body + secret + timestamp)))), empty body for GET.
- Hosts in code: `paymentadminapi.svea.com`, `paymentsdocs.svea.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Svea Bank AB NUF). svea.com/nb-no live and lists Checkout under payment solutions.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

GET https://paymentadminapi.svea.com/api/v2/reports?date=YYYY-MM-DD&includeWithholding=true is per day, so a month = up to 31 requests (6 parallel; 404 'report not generated' treated as no payout; dates today or later are skipped because the API rejects them). Payout = paymentReport.sveaPaidAmountIncludingWithholding, fees = feeAmountExcludingVat + feeVatAmount. Amounts are typed Long and treated as minor units (docs state minor units for amounts and the example 39800 = two rows of 19900); verify with a real report. Only covers Svea Checkout with Svea as payment facilitator; the separate Finnish 'Svea Payments' (ex Maksuturva) product is not covered. Read-only reconcile + CSV.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
