# Hybel Journal

Route `/app/hybel/`. Docs pages: `web/content/{nb,en}/web-apps/hybel/index.md`.

Books one month of the Hybel Premium Bilagsjournal (CSV) as one balanced ReAI review voucher with a SHA-256 fingerprint. Tenant detail stays in Hybel.

## Vendor docs

- Accounting reports: https://hjelpesenter.hybel.no/knowledge/hvordan-tar-jeg-ut-regnskapsrapporter
- Bilagsjournal export: https://hjelpesenter.hybel.no/knowledge/hvordan-kan-jeg-importere-husleie-forfall-og-innbetalinger-til-mitt-regnskapssystem
- Premium accounting: https://hjelpesenter.hybel.no/knowledge/hvordan-kan-hybel-premium-forenkle-regnskapsf%C3%B8ring-av-husleie
- SAF-T: https://hjelpesenter.hybel.no/knowledge/st%C3%B8tter-hybel-saf-t-regnskap

## API version

None. Hybel offers no customer API (rechecked 2026-11-28); exports come in layouts for named ERPs. Export file import, no provider calls.

## Input

Rapporter → Innstillinger (accounts, VAT code 0), then Rapporter → Bilagsjournal → period + CSV format → Last ned. Column list is not published, so `journal.js` maps headers heuristically (date, account, reference/BatchID, signed amount or debit/credit, description, VAT) with manual override. One calendar month; every date + reference group must balance; VAT must be blank or 0.

## ReAI endpoints and budget

Contract: https://app.reai.no/openapi/public.

- `GET /api/company-settings` (org.nr must match the Hybel report, company NOK)
- `GET /api/chart-of-accounts/accounts?accountNumberPrefix=…&accountNumberPrefix=…&limit=100`, 20 prefixes per call (repeated query keys per the array parameter); a batch that hits the 100 cap is rechecked per account
- `GET /api/company-banks` (19xx and bank-ledger accounts must map to exactly one active NOK bank)
- `GET /api/vouchers?startDate&endDate&includeReversed=true` all pages, duplicate marker `Hybel journal <org.nr> <YYYY-MM>`
- `POST /api/manual-vouchers` (date = last journal date, review reason, postings)
- Validate or create: 4 + ceil(accounts / 20) + voucher pages subrequests (sample: 5).

## Mapping

Each Hybel entry (date + reference) is paired separately with `pairVoucherRows`, row numbers continue across entries. All postings use VAT code `0`, which the ReAI contract prescribes for non-VAT postings (residential rent is outside VAT). Bank accounts get `companyBankId`. Accounts 1500, 2400, 2910 and other subledger accounts are rejected.

## Caveats

- Heuristic column mapping; verify on a real export from each ERP layout.
- VAT-liable postings (commercial rent) are not supported.

Last verified: 2026-11-28
