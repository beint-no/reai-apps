# Spense Settlement Reconcile

Route `/app/spense/`. Docs pages: `web/content/{nb,en}/web-apps/spense/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.spensepay.com/guides/getting-started
- https://developer.spensepay.com/guides/authenticating
- https://developer.spensepay.com/guides/settlements
- https://developer.spensepay.com/apis/partner/settlements
- https://developer.spensepay.com/_bundle/apis/partner.json?download
- https://www.tripletex.no/integrasjoner/spense/

- Mode: csv
- Auth: None in the app (file upload). Spense does give customers API keys (client ID/secret in Spense Portal app.spensepay.com, OAuth2 client_credentials at https://api.spensepay.com/partner/auth/token, scope organization:accounting:read), but GET /partner/settlements/generate_csv requires a JSON request body on a GET, which Worker fetch (and Node fetch) refuse to send.
- Hosts in code: `api.spensepay.com`, `developer.spensepay.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. spense.no live, sells dealership payments.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vouchers`

## Caveats

Imports the documented 'payouts' (Date of payout,Payment provider,Reference,Currency,Gross Amount,Fees,Net Amount) or 'transactions' (grouped by Settlement reference) CSV formats; machine_readable format not supported (ragged rows). Not documented whether the Spense Portal UI offers a CSV download, so the docs say to get the CSV in those formats and mention the API key route for developers. Optional review voucher: per payout row bank(companyBankId) debit net / clearing 1580 credit, and fee 7770 debit / clearing credit for gross minus net only (fees invoiced later are not booked). Duplicate marker on description. If Spense adds a POST or query-parameter variant of generate_csv, this can switch to api mode.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
