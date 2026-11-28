# Mynt Card Expenses

Route `/app/mynt/`. Docs pages: `web/content/{nb,en}/web-apps/mynt/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.mynt.com/get-started-with-mynt-platform
- https://help.mynt.com/en/articles/612739-export-via-excel
- https://help.mynt.com/en/articles/612759-reports-for-csv-and-sie-exports
- https://www.mynt.com/en/guides/bulk-export-transactions
- https://intercom.help/mynt/nb/articles/11951403-sett-opp-regnskapsinnstillingene-dine-i-mynt
- https://www.tripletex.no/integrasjoner/mynt/

- Mode: csv
- Auth: None (file upload). Mynt's only API is the Partner API (partner-api.mynt.se); tokens are 'provided by Mynt when your partnership begins' and production is IP-whitelisted, so card customers cannot get a key.
- Hosts in code: `docs.mynt.com`, `help.mynt.com`
- Vendor status: Swedish company (org.nr 559100-8874 per mynt.com footer), no Norwegian register entry. mynt.com live, sells corporate cards and expense management.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vouchers`

## Caveats

Uses documented export field names (Transaction date, Export date override, Amount, Currency, VAT rate, Reverse VAT, Description, Account, Category, Comment, Person, Project). Mynt does not document the amount sign, so the dominant sign is treated as purchases and the rest as refunds. VAT rate 25/15/12 maps to ReAI input VAT codes 1/11/13 (code 1 is confirmed vat_inclusive by the ReAI OpenAPI; 11 and 13 assumed to be the standard SAF-T codes present in GET /api/vat-codes); Reverse VAT lines get code 0 for the accountant to fix in review. One row per line (expense vs card account, default 1925, as Mynt recommends a separate 19xx account). support@mynt.com also listed on mynt.com contact page; no partner/integrations address published.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
