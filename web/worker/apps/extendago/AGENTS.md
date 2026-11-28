# ExtendaGO

Route `/app/extendago/`. Docs pages: `web/content/{nb,en}/web-apps/extendago/index.md`.

## Purpose

Books the daily GBAT10 accounting file that ExtendaGO (formerly Wallmob) delivers to SFTP as one balanced ReAI review voucher.

## Vendor docs

- GBAT10 mapping (format reference): https://www.extendago.com/wp-content/uploads/sites/3/2023/05/gbat10-mapping.pdf
- Accounting SFTP setup (2025 guide, SIE4 variant via Sharespine): https://www.extendago.com/wp-content/uploads/sites/3/2025/01/extendago-x-sharespine-accounting-integration-guide.pdf
- No public changelog.

## API

- None used. The GO POS API has no public documentation (given on request after a plan review via extendago@extendaretail.com), so customers cannot self-serve a key. The documented export is used instead.
- File: semicolon separated, 30 columns. Read here: 0 `GBAT10`, 1 report number, 2 date `YYYYMMDD`, 6 account, 7 VAT code (0 for tenders), 8 amount with `.` decimals, 20 description, 24 department. Tenders are negative, revenue incl. VAT positive, deviations a revenue line of either sign. The sign is taken from the tender lines, so a file with the opposite convention books the same way.
- One report date per file; one file per day.

## Subrequest budget

- Preview: 0 (local parse).
- Book: `GET /api/vouchers`, `GET /api/vat-codes`, `POST /api/manual-vouchers` = 3.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true` duplicate check on `ExtendaGO report N YYYY-MM-DD`.
- `GET /api/vat-codes` to validate that each file VAT code is a non reverse charge, VAT inclusive ReAI code that is not input VAT.
- `POST /api/manual-vouchers` with `pairVoucherRows` postings.

## Accounting mapping

- Accounts and VAT codes come from the ExtendaGO accounting settings (customer sets ReAI accounts and output VAT codes such as 3, 31, 33 there). Tenders debit, revenue credit VAT inclusive, VAT code 0 rows posted with code `0`.
- GBAT10 has no currency column; postings use the company's accounting currency.
- Department numbers are shown in descriptions only (ReAI needs department ids).

## Caveats

- The mapping PDF dates from 2021 (Wallmob). ExtendaGO's newer accounting guide shows an SIE4 SFTP variant; only GBAT10 is parsed.

Last verified: 2026-11-28
