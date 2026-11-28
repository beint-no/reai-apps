# Dintero Fees

Route `/app/dintero/`. Docs pages: `web/content/{nb,en}/web-apps/dintero/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.dintero.com/api-reference/settlements/aid_settlements_list.md
- https://docs.dintero.com/api-reference/authenticate/aid_auths_oauth_token_post.md
- https://docs.dintero.com/docs/checkout/checkout-client.md
- https://docs.dintero.com/docs/checkout/payout-reports-introduction.md

- Mode: fix
- Calls: Same documented Dintero calls, now exported as fetchApi(fields, start, end, fetchImpl) with doc URLs above it. The fee voucher uses pairVoucherRows so debit and credit share one rowNumber; vatCode 0 kept on both (balance account and VAT-exempt payment fee, flagged for review). Docs pages gained setup steps (Backoffice Settings, API clients, Create new API client) and lost the em dash in seoTitle.
- Hosts in code: `api.dintero.com`, `docs.dintero.com`
- Vendor status: Brreg: Dintero AS active, last accounts 2025; dintero.com and docs.dintero.com live with current settlements API.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/chart-of-accounts/accounts`
- `/api/manual-vouchers`
- `/api/vouchers`

## Caveats

The settlements schema does not state the unit of amounts; the module treats them as minor units like the rest of the Dintero API. The Backoffice client must be granted a settlements/reports scope (read:settlements, read:reports or read:billing); a plain checkout client may lack it.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
