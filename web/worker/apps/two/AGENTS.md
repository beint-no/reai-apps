# Two B2B

Route `/app/two/`. Docs pages: `web/content/{nb,en}/web-apps/two/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.two.inc/openapi/checkout-api.yaml
- https://docs.two.inc/docs/api/checkout/get-merchant-statement-handler-get/
- https://docs.two.inc/docs/guides/settlement-report-guide/
- https://docs.two.inc/docs/guides/getting-api-keys-page/

- Mode: fix
- Calls: GET https://api.two.inc/v2/merchant/statement?start_date&end_date&filetype=csv&country_code=NO with X-Api-Key; parses the documented report columns (Payment Reference, Settlement Date, Currency, Settlement Type, Gross Settlement, Net Settlement Amount, Total Fee Tax Rate), keeps only GROSS_PAID/NET_PAID/PAID rows, groups per payment reference (credit notes reduce the payout). One review voucher per payout: debit net payout (1580), debit fee = gross − paid (7770, ReAI input VAT code from /api/vat-codes when the report states a fee VAT rate, else 0), credit gross (1579), all three accounts editable, paired with pairVoucherRows. Manual form removed (admins create production keys themselves). Docs rewritten.
- Hosts in code: `api.two.inc`, `docs.two.inc`
- Vendor status: Brreg 925976105 TWO AS (dataprogrammeringstjenester): konkurs false, underAvvikling false, tvangsavvikling false, no slettedato. two.inc is live and docs.two.inc publishes the Order API spec.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

The guide lists the CSV column names but not delimiter or number format; parser accepts comma or semicolon and 9200.00 / 9,200.00 / 9200,00. Only NOK and country_code NO. fetchApi creds changed (apiKey instead of apiToken) and returns an array of settlements: web/test/provider-api.test.mjs two case needs updating. parseCsv from hybel-journal.js rejects files over 5,000 lines.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
