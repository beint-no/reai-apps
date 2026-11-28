# SumUp Reconcile

Route `/app/sumup/`. Docs pages: `web/content/{nb,en}/web-apps/sumup/index.md`.

Lists SumUp payout records for one month, matches them against pending ReAI bank transactions and exports a CSV. Nothing is booked.

## Vendor docs

- Reference: https://developer.sumup.com/api/payouts/list
- Auth (API keys): https://developer.sumup.com/tools/authorization/api-keys/
- Changelog: https://developer.sumup.com/changelog

## API version

`v1.0` (`/v1.0/merchants/{merchant_code}/payouts`), the only documented version of List payouts; no deprecation notice.

## Auth

Customer creates an API key at me.sumup.com → Settings → For Developers → Toolkit → API Keys and enters the merchant code. Sent as `Authorization: Bearer <key>` (OAuth scope `payouts.read` also works but is not used).

## Endpoints

- `GET https://api.sumup.com/v1.0/merchants/{merchant_code}/payouts?start_date&end_date&format=json&limit=9999&order=asc`
  (dates inclusive, `YYYY-MM-DD`; `limit` max 9999, default undocumented, so the maximum is sent).
- Fields: `id`, `type` (PAYOUT or one of the deduction types), `status` (SUCCESSFUL, FAILED), `amount`, `fee`, `currency`, `date`, `reference`, `transaction_code`.

## Paging, rate limits, subrequests

- No paging; one call per review. A full 9999 row response is reported as an error instead of silently truncating.
- No rate limit documented; 429 is reported.
- Review: 1 SumUp call + 1 ReAI call. Page load: 1 ReAI call.

## ReAI endpoints

- `GET /api/company-banks` (via `loadActiveBanks`)
- `GET /api/bank-reconciliations/{bankAccountId}?month&include=pending_transactions` (via `loadPendingBankTransactions`)

## Matching

- Only `SUCCESSFUL` `PAYOUT` rows in the company currency are matched, per row, by amount (minor units), ±8 days and reference (`matchPayouts`).
- Successful deduction rows are counted and shown as a note, not matched.

## Caveats

- Each row carries `transaction_code`, so one bank deposit may cover several rows; SumUp does not document how rows aggregate into a deposit, whether `amount` is net of `fee`, or the sign of deduction amounts, so matching stays per row.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
