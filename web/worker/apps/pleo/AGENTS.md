# Pleo Export to ReAI

Route `/app/pleo/`. Docs pages: `web/content/{nb,en}/web-apps/pleo/index.md`.

Books the oldest open Pleo export job as one ReAI review voucher and reports the result back to
Pleo (Level 1 export integration).

## Vendor docs

- Standalone API keys (auth): https://developers.pleo.io/docs/current/authentication/standalone-api-keys-overview.md
- Creating a key: https://developers.pleo.io/docs/current/how-tos/api-keys/how-to-generate-standalone-api-keys.md
- Export workflow guide: https://developers.pleo.io/docs/current/guides/export-integration-workflow-guide.md
- List export jobs: https://developers.pleo.io/reference/export-api/export-api-v3/get-a-list-of-export-jobs.md
- Export items: https://developers.pleo.io/reference/export-api/export-items-v3/get-export-items.md
- Update job items: https://developers.pleo.io/reference/export-api/export-api-v3/update-export-job-items.md
- Job events: https://developers.pleo.io/reference/export-api/export-api-v3/create-an-export-job-event.md
- Scopes: https://developers.pleo.io/reference/export-api/export-api-scopes.md
- Journal bookkeeping method: https://developers.pleo.io/docs/current/integration-design/exports/integration-design-exports-bookkeeping-method-journal-entry.md

## API version and auth

- Export API v3 (spec 33.25.0, checked 2026-11-28; no v4 and no v3 deprecation). v3 replaces
  the legacy Expenses API, which does not accept standalone keys.
- The customer asks Pleo Support to enable API keys, then creates one under Settings → API Keys
  with `export-jobs:read`, `export-jobs:write`, `export-items:read`.
  Header: `Authorization: Basic base64(<key>:)` (key as username, empty password).
- Host: `https://external.pleo.io`.

## Endpoints

- `GET /v3/export-jobs?statuses=pending&statuses=in_progress&limit=100`; the oldest by
  `createdAt` is picked locally (sorting key names are not documented).
- `GET /v3/export-items?job_id=&limit=100&after=` cursor paging (`pagination.hasNextPage`,
  `endCursor`), at most 50 pages. No maximum `limit` is documented. Values are in cents;
  `tax.rate` is a fraction (0.25); `date` is a UTC date-time.
- `POST /v3/export-job-events` (`started`, `completed`, `failed`).
- `PUT /v3/export-jobs/{id}/items` in batches of 100 (`in_progress`, `successful` with
  `externalId`/`externalUrl`/`exportedAt`, or `failed` with `failureReasonType`).
- No rate limit is documented.

## Subrequests per action (n items)

- Fetch: 1 + ceil(n/100).
- Book: fetch again server side (1 + ceil(n/100)), ReAI `GET /api/vouchers` pages, `GET /api/vat-codes`,
  1 started event (pending jobs), 2 × ceil(n/100) item updates, 1 `POST /api/manual-vouchers`,
  1 completed event. About 9 for a job of up to 100 items.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?voucherType=manual&includeReversed=true` over the job's date range (duplicate check on the description marker `Pleo export <jobId>`)
- `GET /api/vat-codes` (input VAT, `vat_inclusive`, not reverse charge, rate match)
- `POST /api/manual-vouchers` with `reviewReason`, rows from `pairVoucherRows` per item

## Accounting mapping

- Each `accountingEntryLines` entry: debit `account.code` with `lineAmount.inWalletCurrency`
  (gross) and the ReAI input VAT code for `tax.rate` (`tax.type` must be `inclusive`).
- Credit `contraAccount.code` with the item total (`amount.inWalletCurrency`); lines must add up.
- Signs follow Pleo, so refunds reverse both sides. Date = the Europe/Oslo day of the item `date`.
- Only `bookkeeping.method` `journal` or `none` is booked; others (accounts payable) stay in Pleo.
- On a ReAI error the items and job are reported `failed`. If the voucher already exists (an
  earlier run stopped after booking), the items are marked successful and the job completed.

## Caveats

- Only four digit Pleo accounts and NOK wallets are accepted.
- The Pleo accounting settings may need the custom API integration selected so that Export
  creates jobs for this key; not verified without an account.
- Multi-entity organisations would need `company_id`, which is not sent.
- The key stays in a hidden form field between preview and book.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
