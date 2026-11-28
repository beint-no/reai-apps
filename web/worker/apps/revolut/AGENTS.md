# Revolut Business Card Expenses

Route `/app/revolut/`. Docs pages: `web/content/{nb,en}/web-apps/revolut/index.md`.

Fetches completed NOK card payments, card refunds and fees for a period and creates one ReAI review voucher against the Revolut bank account.

## Vendor API

- Reference: https://developer.revolut.com/docs/api/business#tag-transactions
- OpenAPI (released continuously, last spec release 2026-11-26): https://github.com/revolut-engineering/revolut-openapi/blob/master/yaml/business.yaml
- Create an API key: https://developer.revolut.com/docs/guides/api-console/create-key
- Signing: https://developer.revolut.com/docs/guides/api-console/make-a-request and https://developer.revolut.com/docs/guides/api-console/signing-requirements
- Retrieve transactions guide: https://developer.revolut.com/docs/guides/manage-accounts/accounts-and-transactions/retrieve-transactions

API version: Business API 1.0 (`https://b2b.revolut.com/api/1.0`), the current and only version. Auth is API keys from the API Console; the older OAuth access token method is marked deprecated in the spec and is not used.

Auth: API key with permission Accounts → Transactions → Read (`transactions:read`), header `Authorization: Bearer <key>`. If the key has signing enabled, `Revolut-Api-Timestamp` (ms) and `Revolut-Api-Signature` = base64 Ed25519 over timestamp + `GET` + path from `/api` + URL-encoded query without `?` (no body), using the console's `private.pem`.

Endpoint: `GET /transactions?from=<day before>T22:00:00Z&to=<day after>T00:00:00Z&count=1000&state=completed`. Fields: `type, state, created_at, merchant.name, legs[].amount, fee, currency, description`.

Paging and budget: newest first; next page uses the last `created_at` as `to` (exclusive), up to 20 pages of 1000. Fetch action: 1 request per 1000 completed transactions (normally 1). Book action: 2 ReAI requests (duplicate check, create). No rate limit is published.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate=&endDate=&includeReversed=true` (duplicate check by description marker)
- `POST /api/manual-vouchers` (review voucher)

## Mapping

`card_payment` leg amount → debit the chosen expense account; `card_refund` → credit the same account; leg `fee` and `fee` transactions → `7770`; counter posting on the Revolut bank account (default `1925`). Each line is its own row pair via `pairVoucherRows`. Amounts are in minor units, NOK only; other currencies are counted and skipped. Each transaction is dated by the Europe/Oslo day of `created_at` (the field the API filters on), so consecutive periods neither overlap nor leave gaps.

## Caveats

- VAT code 0 on every line; the user sets VAT (for example reverse charge) when attaching receipts.
- Non-NOK legs are skipped because the API gives no NOK amount; `bill_amount` could be used when `bill_currency` is NOK.
- Transactions sharing the exact `created_at` microsecond at a page boundary could be skipped (theoretical).
- The duplicate marker is month, line count and total; booking an overlapping period with different lines is not detected.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
