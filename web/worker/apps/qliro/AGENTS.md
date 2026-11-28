# Qliro Checkout Settlement Reconcile

Route `/app/qliro/`. Docs pages: `web/content/{nb,en}/web-apps/qliro/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.qliro.com/docs/qliro-checkout/settlements
- https://developers.qliro.com/docs/api
- https://github.com/getsno/qliro-api/blob/master/.junie/api-docs.json
- https://github.com/krokedil/qliro-one-for-woocommerce/blob/HEAD/classes/requests/class-qliro-one-request.php

- Mode: api
- Auth: Merchant API key/secret issued by Qliro for the Qliro Checkout store (ask Qliro store support if missing). Only the secret is needed for GET: Authorization: 'Qliro ' + base64(SHA256(body + apiSecret)) with empty body.
- Hosts in code: `developers.qliro.com`, `github.com`, `payments.qit.nu`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Qliro AB NUF). qliro.com live with merchant offering.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

developers.qliro.com returned a Fastly 'unknown domain' 500 during research (2026-11-28) and the Internet Archive was offline, so the Admin API OpenAPI (GET /v2/settlements/GetSettlementBatches, FromBatchDate/ToBatchDate yyyy/mm/dd, SettlementBatches[].Id/BatchId/AcquirerName/BatchDate/CurrencyCode/TotalAmount/TotalFeeAmount) was read from the docs site's own Next.js page data mirrored in getsno/qliro-api/.junie/api-docs.json. Production host https://payments.qit.nu/checkout/adminapi and the auth hash come from two open-source Qliro clients (krokedil WooCommerce plugin, getsno/qliro-api), not from a live docs page; re-verify once developers.qliro.com is back. Whether TotalAmount is net of TotalFeeAmount is not stated; app treats TotalAmount as the transferred amount. Read-only reconcile + CSV.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
