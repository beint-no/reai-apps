# Revolut & Wise Import

Route `/app/revolut/`. Docs pages: `web/content/{nb,en}/web-apps/revolut/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://github.com/revolut-engineering/revolut-openapi/blob/master/yaml/business.yaml
- https://developer.revolut.com/docs/api/business#tag-transactions
- https://developer.revolut.com/docs/guides/api-console/create-key
- https://developer.revolut.com/docs/guides/api-console/make-a-request
- https://developer.revolut.com/docs/guides/api-console/signing-requirements

- Mode: fix
- Calls: Revolut Business only. GET https://b2b.revolut.com/api/1.0/transactions?from&to&count=1000 with Bearer API key and optional Ed25519 signing (timestamp + GET + /api path + query) using the private.pem from the API Console; paginates by last created_at as to. Imports state=completed card_payment and fee transactions in NOK only (leg.amount to the chosen expense account, leg.fee and fee transactions to 7770), skipped foreign legs are reported. Each expense is paired with its own credit on the Revolut bank account on the same date via pairVoucherRows; vatCode 0 with a note to set VAT on review. CSV upload and Wise removed. Docs pages rewritten with API Console steps.
- Hosts in code: `b2b.revolut.com`, `developer.revolut.com`, `github.com`
- Vendor status: Foreign vendor (Lithuania), not in Brreg. Revolut Business is sold and its Business API spec is current (revolut-openapi business.yaml, API keys via API Console).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vouchers`

## Caveats

Wise removed from this slug; if Wise should be offered it needs its own slug and a design that does not book transfers as expenses (personal tokens in the EEA also cannot read statements). Non-NOK accounts are skipped because the API gives no NOK amount; bill_amount could be used later when bill_currency is NOK. Ed25519 Web Crypto is used for signing (supported in Workers and Node). fetchApi creds changed (apiKey, signingKey, expenseAccount; no provider/apiToken) and returns {lines, skippedForeign}: web/test/provider-api.test.mjs revolut cases need updating. Brand/title changed from Revolut / Wise to Revolut Business; apps.json/catalog naming may need the same.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
