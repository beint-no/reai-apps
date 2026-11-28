# Paddle

Route `/app/paddle/`. Docs pages: `web/content/{nb,en}/web-apps/paddle/index.md`.

## Vendor API

No documentation link recorded yet. Find the vendor's current primary docs before changing provider calls.

- Hosts in code: `api.paddle.com`

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vouchers`

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
