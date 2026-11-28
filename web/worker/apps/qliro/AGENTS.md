# Qliro Checkout Settlement Reconcile

Route `/app/qliro/`. Docs pages: `web/content/{nb,en}/web-apps/qliro/index.md`.

Read-only reconciliation: lists Qliro Checkout settlement batches (one per bank transfer) for a month, matches them to pending ReAI bank transactions and exports a CSV. Nothing is written to ReAI.

## Vendor API

- Reference (Admin API v2 OpenAPI, embedded in the page): https://developers.qliro.com/docs/api
- Settlement guide: https://developers.qliro.com/docs/qliro-checkout/settlements
- Archived copy used for this check (developers.qliro.com returned Fastly 500 again on 2026-11-28): https://web.archive.org/web/20260122220505/https://developers.qliro.com/docs/api
- Auth and production host reference implementation: https://github.com/krokedil/qliro-one-for-woocommerce/blob/HEAD/classes/requests/class-qliro-one-request.php
- Changelog: none published.

API version: Admin API v2 (`info.version` v2, the only settlement version in the spec).

Auth: the merchant API secret Qliro issues for the Qliro Checkout store (ask Qliro merchant support). Header `Authorization: Qliro base64(SHA-256(body + secret))`; GET has an empty body, so only the secret is needed.

Endpoint: `GET https://payments.qit.nu/checkout/adminapi/v2/settlements/GetSettlementBatches?FromBatchDate=yyyy/mm/dd&ToBatchDate=yyyy/mm/dd&CurrencyCode=<ReAI company currency>`. Fields used: `SettlementBatches[].Id, BatchId, AcquirerName, BatchDate, CurrencyCode, TotalAmount, TotalFeeAmount`. `ToBatchDate` is capped at yesterday (today gives `PERIOD_NOT_SETTLED`).

Paging and budget: the response is one unpaged list. Review action: 1 Qliro request plus 1 ReAI request (`/api/bank-reconciliations/{id}`). Page load: 1 ReAI request (`/api/company-banks`). No rate limit documented.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/company-banks` (bank selector)
- `GET /api/bank-reconciliations/{bankAccountId}?month=&include=pending_transactions`

## Mapping

Each batch becomes one payout row: amount `TotalAmount` in minor units, fee `|TotalFeeAmount|`, reference `BatchId`, date `BatchDate`. Rows are matched to pending bank transactions with `matchPayouts` (`web/worker/lib/reconcile.js`).

## Caveats

- developers.qliro.com was still down (Fastly 500) on 2026-11-28; the spec was re-read from the Internet Archive snapshot of 2026-01-22. The spec lists only the test server `pago.qit.nu`; the production host `payments.qit.nu` and the hash scheme come from Qliro's open-source clients.
- Whether `TotalAmount` is net of `TotalFeeAmount` is not stated; the app treats `TotalAmount` as the transferred amount.
- `CurrencyCode` filtering is done by Qliro; the app still drops other currencies locally as a guard.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
