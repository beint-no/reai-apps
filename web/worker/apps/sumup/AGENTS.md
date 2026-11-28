# SumUp Reconcile

Route `/app/sumup/`. Docs pages: `web/content/{nb,en}/web-apps/sumup/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.sumup.com/api/payouts/list
- https://developer.sumup.com/tools/authorization/api-keys/

- Mode: keep
- Calls: No code change. NB/EN docs body rewritten with the real key path (me.sumup.com → Settings → For Developers → Toolkit → API Keys), em dashes removed.
- Hosts in code: `api.sumup.com`
- Vendor status: Foreign vendor (UK/Ireland), not in Brreg. SumUp card terminals are sold in Norway and the Payouts API is documented at developer.sumup.com.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

Rows carry transaction_code, so a bank payout may consist of several rows sharing one reference; SumUp does not document the aggregation, so matching stays per row. Deduction types (REFUND_DEDUCTION etc.) are ignored.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
