# Sitoo POS Z-report Accounting

Route `/app/sitoo/`. Docs pages: `web/content/{nb,en}/web-apps/sitoo/index.md`.

Combines the POS Z-reports closed on one Oslo day into one balanced review voucher: tenders against sales by VAT rate.

## Vendor docs

- Introduction (auth, base URL, errors): https://developer.sitoo.com/introduction
- Z-reports reference: https://developer.sitoo.com/api-reference/z-reports
- Reference overview: https://developer.sitoo.com/api-reference/overview
- Release notes: linked from developer.sitoo.com

## API version

REST API `v2` (`/v2/accounts/{account_id}/...`), the only current version on 2026-11-28; no deprecation notices on the Z-report endpoints.

## Auth

Sitoo Backoffice → Settings / Sitoo REST API (Administrator, API extension): generate a password for the API user. The form takes base URL (default `https://api.mysitoo.com`), account ID, API ID and password; calls send `Authorization: Basic base64(apiId:password)`. Never stored. If the key is IP restricted, Worker egress must be allowed.

## Endpoints

- `GET /v2/accounts/{account_id}/pos-z-reports?dateaddedfrom=&dateaddedto=` (Unix seconds). Sorted by `dateadded` ascending, at most 500 items; the next call starts at the last `dateadded` (inclusive, deduplicated by `registerid|zreportid`). Window: the day start in Oslo minus slack to four days later, then filtered locally on `datecreated` in Europe/Oslo.
- Fields used: `zreportid`, `registerid`, `registernumber`, `datecreated`, `dateadded`, `currencycode`, `vatgroupssales`/`vatgroupsrefund` (`vatvalue`, `moneytotal`), `paymentssales`/`paymentsrefund` (`name`, `moneytotal`), `moneyroundoff`.

## Budget and limits

Fetch: 1 call per 500 reports (normally 1), capped at 10. Book: `GET /api/vat-codes`, `GET /api/vouchers` (1+ pages), `POST /api/manual-vouchers`. Sitoo documents `429` without published limits.

## ReAI API

- `GET /api/vat-codes`: checks codes 3/31/33 (VAT inclusive output) and 5 (0%) exist with the expected rate before booking.
- `GET /api/vouchers?startDate=&endDate=&includeReversed=true` duplicate check on `Sitoo Z-reports <date>`.
- `POST /api/manual-vouchers` with `reviewReason`, rows from `pairVoucherRows`.

## Mapping

Sales gross per VAT rate: 25% 3000/code 3, 15% 3010/31, 12% 3020/33, 0% 3100/5; refunds debit the same accounts. Tenders: cash 1900, gift card 2900, invoice 1570, others 1580; refunds credit them. Round off 7790. Only NOK reports; other currencies and VAT rates are errors.

## Caveats

The refund sign in `vatgroupsrefund`/`paymentsrefund` is not documented, so absolute values are used. Store Z-reports need Sitoo backend configuration and are not used.

Last verified: 2026-11-28.
