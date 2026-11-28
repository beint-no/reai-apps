# PayPal POS (Zettle) Reconcile

Route `/app/zettle/`. Docs pages: `web/content/{nb,en}/web-apps/zettle/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://github.com/iZettle/api-documentation/blob/master/authorization.md
- https://github.com/iZettle/api-documentation/blob/master/finance-api/api-reference-v2.yaml
- https://github.com/iZettle/api-documentation/blob/master/finance-api/user-guides/fetch-account-transactions-v2.md
- https://www.zettle.com/no

- Mode: rename
- Calls: Brand PayPal Point of Sale (Zettle) in title, lead, UI and docs. Balance currency read from currencyId; start/end without Z; accepts both the reference (array, originatorTransactionUuid, string amount) and the user guide shape (data, originatingTransactionUuid); limit 1000 with offset paging; fetchZettlePayouts exported with fetchImpl for testing. Docs rewritten with my.zettle.com/apps/api-keys steps.
- Hosts in code: `finance.izettle.com`, `github.com`, `oauth.zettle.com`
- Vendor status: Foreign vendor, not in Brreg. zettle.com/no says "Zettle by PayPal blir til PayPal Point of Sale"; still sold in Norway (PayPal Reader from 249 kr). Finance API v2 still documented in iZettle/api-documentation.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- none

## Caveats

Slug, icon and URL stay zettle; coordinator should decide whether to add a paypal-pos alias and update apps.json/catalog names. With the new PayPal linked model payouts can go to the PayPal Wallet instead of a bank account, so some payouts will not match a bank line. The API key page my.zettle.com/apps/api-keys is from the developer docs and was not verified after the rebrand.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
