# Dintero Fees

Route `/app/dintero/`. Docs pages: `web/content/{nb,en}/web-apps/dintero/index.md`.

Purpose: list paid Dintero settlements for a month, match net payouts against pending ReAI bank transactions and optionally book the withheld fees as one review voucher.

## Vendor docs

- Settlements reference: https://docs.dintero.com/api-reference/settlements/aid_settlements_list.md
- Auth: https://docs.dintero.com/api-reference/authenticate/aid_auths_oauth_token_post.md, https://docs.dintero.com/docs/checkout/checkout-client.md
- Payout reports: https://docs.dintero.com/docs/checkout/payout-reports-introduction.md
- Changelog: none published for the settlements API; the reference index is https://docs.dintero.com/llms.txt (no deprecation found, 2026-11-28)

## API version and auth

- `https://api.dintero.com/v1`, the current and only version.
- Key: Dintero Backoffice, Settings → API clients → Create new API client; the client needs one of `read:settlements`, `read:reports` or `read:billing`.
- `POST /v1/accounts/{aid}/auth/token` with `Authorization: Basic base64(client_id:client_secret)` and `{ grant_type: client_credentials, audience: https://api.dintero.com/v1/accounts/{aid} }`, then `Authorization: Bearer <access_token>`. One token per action.

## Endpoints and paging

- `GET /v1/accounts/{aid}/settlements?limit=1000&created_at.gte=<month start - 1 day>&created_at.lte=<month end + 1 day>` (`created_at.*` filter `settled_at`). Each settlement is kept by its Europe/Oslo `settled_at` day and `payment_status` `paid`; one payout per `amounts[]` entry.
- Paging: `starting_after_id` + `starting_after_date` from `last_evaluated_key` until it is absent; repeated ids abort; at most ten pages, then an error.
- Rate limits: none published; `429` with `Retry-After` is reported to the user with the wait.

## Subrequest budget

- Review: 1 token + settlement pages (usually 1) + 1 ReAI pending bank transactions = 3 typical.
- Fee voucher: 4 (vouchers on the last day, two account checks, POST).

## ReAI endpoints

- `GET /api/company-banks` (page load), `GET /api/bank-reconciliations/{bankId}?month=&include=pending_transactions`
- `GET /api/vouchers?startDate=<last day>&endDate=<last day>&voucherType=manual` for the duplicate marker
- `GET /api/chart-of-accounts/accounts?accountNumberPrefix=`
- `POST /api/manual-vouchers`

## Accounting mapping

- Payouts in the ReAI company currency only; others are counted as excluded. Match: same currency and amount within eight days, reference or unique candidate.
- Fee voucher on the month's last day: debit fee expense account, credit payout clearing account, VAT code `0` on both (payment fees are VAT exempt; the contract asks for `0` on non-VAT rows), paired with `pairVoucherRows`, flagged for review. Marker `Dintero withheld fees <aid> <month>`. Test accounts (`T…`) cannot book.

## Caveats

- The settlements schema does not state the amount unit; minor units are assumed as in the rest of the Dintero API.
- No live verification (no credentials).

Last verified: 2026-11-28
