# Muntra Ledger to ReAI

Route `/app/muntra/`. Docs pages: `web/content/{nb,en}/web-apps/muntra/index.md`.

Purpose: sum the Muntra general ledger (patient invoices, payments, HELFO claims and fees as Muntra books them) for a
period by account and book it as one balanced ReAI review voucher dated the last day of the period.

## Vendor docs

- Reference (ReDoc): https://api.muntra.com/api/documentation
- OpenAPI 3.0: https://api.muntra.com/docs (info.version 3.5.234 on 2026-11-28; no changelog or deprecation notices published)
- Transactions: operation `GET /api/transactions` (tag `transactions`) in the spec
- Token policy: operation `POST /api/personal-access-tokens` in the spec ("Disabled ... Contact Muntra support to create a personal access token")

## API version

Muntra publishes one unversioned REST API (`/api/...`), spec version 3.5.234. No older or newer variant exists.

## Auth

Muntra support creates a personal access token for a Muntra user (support@muntra.se, from https://www.muntra.no/kontakt).
Sent as `Authorization: Bearer <token>`. Clinics can also restrict API access by IP (`/api/allowed-ip-addresses`);
Cloudflare egress IPs are not fixed, so such a restriction would block this app.

## Endpoint

`GET https://api.muntra.com/api/transactions?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD[&fiscal_year_id=]`

- Both dates are required; `to_date` must be after `from_date` and the range may not exceed three months (spec).
  The app enforces both before calling.
- No paging parameters are documented; the response is `{ data: TransactionResponse[] }` with
  `attributes.amount`, `account_number`, `account_name`, `cost_center_code`, `cost_center_name`.
- Transactions carry no date of their own (the date is on the verification), which is why the app books one summary
  voucher for the period instead of one per day.

## Subrequests per action

- Fetch: 1 (Muntra).
- Book: 1 Muntra re-read + ReAI `/api/vouchers` (1 page per 200 vouchers in the period) + `/api/vat-codes` +
  `/api/company-banks` + `/api/chart-of-accounts/accounts` (1 per 20 accounts) + `POST /api/manual-vouchers`.
  Typically 6.
- No documented rate limit for these endpoints.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/vouchers` (duplicate and overlap check: any voucher in the period whose description starts with `Muntra ledger`)
- `/api/vat-codes` (code for sales outside the VAT act: `vatType=outside_scope`, rate 0, preferring code 6)
- `/api/company-banks` (`companyBankId` for bank ledger accounts)
- `/api/chart-of-accounts/accounts` (`accountNumberPrefix` batches, `limit=100`; existence, `restrictedToSystemUsage`,
  `subsidiaryLedger`, `type`)
- `/api/manual-vouchers` (rows built with `pairVoucherRows`)

## Accounting mapping

- Transactions are summed per `account_number`; accounts netting to zero are dropped; the period must sum to 0.00.
- Optional mapping `muntra=reai` (one per line) replaces Muntra account numbers before booking. Muntra's ledger uses a
  BAS style chart (spec examples such as 1040), and Norwegian clinics may have Swedish or custom numbers; the customer
  maps any account that does not exist in ReAI. Receivable accounts that are subledger accounts in ReAI (`1500`,
  `2400`, `2910`, or any account with a non bank `subsidiaryLedger`) are refused with a request to map them, for
  example patient receivables to `1570` and HELFO receivables to `1530`.
- ReAI accounts of type `revenue` get the outside scope VAT code (dental treatment is outside the VAT act); all other
  rows get VAT code 0. Periods with postings on `27xx` (VAT) are refused: Muntra's VAT rows cannot be tied back to
  their revenue rows in a summary, and posting 2700 by hand with code 0 is not allowed.
- Bank accounts (ReAI subsidiary type `bank` or `19xx`) must match exactly one active NOK company bank.
- Company currency must be NOK.

## Caveats and assumptions

- Sign convention assumed: positive `amount` is debit (SIE/BAS convention, Muntra is Swedish). The preview warns when
  revenue accounts net to a debit. Not verified against a live account.
- `to_date` assumed inclusive (the verifications endpoint documents its `to` as inclusive). A boundary error cannot
  unbalance the voucher because all rows of a verification share one date.
- A token user in several Muntra organizations: the spec does not say which organization `/api/transactions` reads.
  The optional `fiscal_year_id` scopes the read to one fiscal year.
- No live verification (no Muntra credentials).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
