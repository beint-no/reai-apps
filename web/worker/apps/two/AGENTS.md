# Two B2B

Route `/app/two/`. Docs pages: `web/content/{nb,en}/web-apps/two/index.md`.

Fetches the Two settlement report for a date range and books each paid NOK payout in ReAI as one
review voucher: net payout, Two fee and the settled gross invoices.

## Vendor docs

- Reference (OpenAPI): https://docs.two.inc/openapi/checkout-api.yaml
- Endpoint: https://docs.two.inc/docs/api/checkout/get-merchant-statement-handler-get/
- Report columns: https://docs.two.inc/docs/guides/settlement-report-guide/
- Auth and keys: https://docs.two.inc/docs/guides/getting-api-keys-page/
- Changelog: none published; the OpenAPI file is the source of truth (checked 2026-11-28).

## API

- Version: `GET /v2/merchant/statement` on `https://api.two.inc`, the current settlement report endpoint.
  `GET /v2/merchant/settlement` (JSON list) has no date filter and no per line fees, so it is not used.
- Key: Two Merchant Portal → Settings → Integration → Production API key. Header `X-Api-Key`.
- Parameters: `start_date`, `end_date` (YYYY-MM-DD, inclusive), `filetype=csv`, `country_code=NO`.
- Columns used: `Payment Reference`, `Settlement Date`, `Currency`, `Settlement Type`, `Gross Settlement`,
  `Net Settlement Amount`, `Total Fee Tax Rate`. Only `GROSS_PAID`, `NET_PAID` and `PAID` lines count; `UNPAID`,
  `PENDING`, `IGNORE` and unknown values are skipped as the spec requires.
- Paging: none; one file per range. Rate limits: not documented.

## Subrequests per action

- Fetch: 1 (Two).
- Book one payout: 3 or 4 (ReAI vouchers for that date, usually one page; VAT codes only when the report
  states a fee VAT rate; create voucher).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true` duplicate check on the description marker
  `Two <payment reference> <date>`
- `GET /api/vat-codes` for the input VAT code (`input_vat`, `vat_inclusive`, not reverse charge) at the fee rate
- `POST /api/manual-vouchers` with `reviewReason`, postings paired by `pairVoucherRows`

## Accounting mapping

Per payment reference and currency: debit net payout (default 1580), debit fee = gross − paid
(default 7770, input VAT code when the report has a fee VAT rate, else VAT code 0), credit gross
settled invoices (default 1579). `GROSS_PAID` lines pay the gross, so their fee is zero. Credit
note lines are negative and reduce the payout. Accounts are editable in the form.

## Caveats

- The guide does not state delimiter, number format or whether the fee tax rate is a fraction or a
  percent; the parser accepts comma or semicolon, `9200.00`, `9,200.00` and `9200,00`, and both rate forms.
- NOK only (`country_code=NO`); booking is refused for a ReAI company with another currency.
- A reversed voucher still counts as a duplicate.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
