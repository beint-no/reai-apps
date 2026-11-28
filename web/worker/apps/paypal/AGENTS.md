# PayPal Withdrawal Reconcile

Route `/app/paypal/`. Docs pages: `web/content/{nb,en}/web-apps/paypal/index.md`.

Lists PayPal Business withdrawals to the bank for one month and matches them against pending ReAI bank
transactions. Read only: nothing is booked; the result downloads as CSV.

## Vendor API

- Reference: https://developer.paypal.com/docs/api/transaction-search/v1/
  (spec https://developer.paypal.com/api/transaction-search/v1/schema.json, version 1.10)
- Auth: https://developer.paypal.com/api/rest/authentication/
- Event codes: https://developer.paypal.com/docs/transaction-search/transaction-event-codes/
- Release notes: https://developer.paypal.com/docs/release-notes/

- API version: Transaction Search v1, the only version; no deprecation notice.
- Auth: the customer creates a live REST app under Apps & Credentials in the PayPal Developer Dashboard,
  turns on Transaction search and pastes client ID and secret. `POST /v1/oauth2/token` with Basic auth and
  `grant_type=client_credentials` (one token per action), then `Authorization: Bearer <token>`.
- Hosts in code: `api-m.paypal.com`
- Vendor status: PayPal (Europe) S.à r.l. et Cie, S.C.A., not in Brreg. Live.

## Endpoints and parameters

`GET /v1/reporting/transactions` with `start_date` and `end_date` at Norwegian midnight with offset
(RFC 3339, max 31 days), `transaction_status=S`, `transaction_currency=<company currency>`,
`fields=transaction_info`, `page_size=500` (max), `page=1..total_pages` (stops at 20 pages).
Kept locally: event codes `T0400` (bank withdrawal), `T0401` (auto sweep) and `T0403` (manual withdrawal)
with negative amounts; `T0402` (withdrawal to Hyperwallet) is skipped. There is one event code per
`transaction_type` filter, so the codes are filtered locally.

Fields read: `transaction_id`, `transaction_event_code`, `transaction_initiation_date` (account time zone,
date part used), `transaction_amount`, `fee_amount`, `transaction_status`, `bank_reference_id`.

## Budget and limits

One action: 1 token + 1 page per 500 matching transactions + 1 ReAI call. Page load: `GET /api/company-banks`.
PayPal does not publish a fixed rate limit; 429 is shown as "wait a minute". Executed transactions can
take up to three hours to appear.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/company-banks` (active banks in the company currency)
- `GET /api/bank-reconciliations/{bankId}?month&include=pending_transactions`

## Accounting mapping

None booked. Docs suggest PayPal balance `1580`, PayPal fees `7770`, bank `1920`.

## Caveats

- Matching uses `matchPayouts` (`web/worker/lib/reconcile.js`): same currency and amount within 8 days,
  reference when the bank text contains it.
- Only withdrawals in the company currency are listed.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
