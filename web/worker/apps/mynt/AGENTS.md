# Mynt Card Expenses

Route `/app/mynt/`. Docs pages: `web/content/{nb,en}/web-apps/mynt/index.md`.

Turns a Mynt expense export (CSV) into one balanced ReAI review voucher: each card line on its expense account
against a separate Mynt card account.

## Vendor API

- Partner API (not for card customers): https://docs.mynt.com/get-started-with-mynt-platform
- Export columns: https://help.mynt.com/en/articles/612739-export-via-excel
- Reports for CSV and SIE: https://help.mynt.com/en/articles/612759-reports-for-csv-and-sie-exports
- Accounting settings (nb): https://intercom.help/mynt/nb/articles/11951403-sett-opp-regnskapsinnstillingene-dine-i-mynt

Version: none. Mynt's only API is the Partner API (`partner-api-token` issued "when your partnership begins",
no version number, non-breaking changes without version updates), so customers cannot get a key and this app reads
the documented export file instead. Vendor: Swedish company, mynt.com live and selling.

## Input

CSV upload, no credentials. Columns used (documented names): Transaction date, Export date override, Amount,
Currency, VAT rate, Reverse VAT, VAT code, Description, Account, Category, Comment, Person, Project.

Subrequest budget: preview = 0. Book = 3 (voucher duplicate check, `GET /api/vat-codes` once, POST).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate=<last date>&endDate=<last date>&includeReversed=true` (marker duplicate check)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers`

## Mapping

One voucher row per line, both sides on the line's date: debit the Mynt **Account** (default 6800) with the VAT code,
credit the card account (default 1925, code 0). Refunds reverse the sides. VAT code: the Mynt **VAT code** when ReAI has
it as an input VAT (VAT inclusive) or reverse charge code; otherwise the ReAI input VAT code (`input_vat`,
`vat_inclusive`) for the **VAT rate**; Reverse VAT lines without a code, and 0 % lines, get code 0. Lines in another
currency than the company currency are rejected. `pairVoucherRows` is not used because it pairs postings across
different dates; each line is already one balanced pair.

## Caveats

- Mynt does not document the Amount sign; the dominant sign in the file is treated as purchases.
- Mynt's VAT code values depend on the customer's Mynt accounting settings; unknown codes fall back to the rate.
- Reverse charge lines without a code need the code set in review.

## Rules

- Use only documented fields of the export; never invent columns.
- Vouchers use real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the export format or caveats change.

Last verified: 2026-11-28.
