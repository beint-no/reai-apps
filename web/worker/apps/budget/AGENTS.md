# Company Budget Importer (budget)

Route `/app/budget/`. Docs pages: `web/content/{nb,en}/web-apps/budget/index.md`.

## Purpose

Uploads a monthly budget per result account from a CSV to ReAI company budgets and shows the saved budget by quarter. Calls no third-party API.

## Input

CSV with a header row: account in column 1, then January to December. Accounts must be 4 digit result accounts (3000 to 8999); duplicates, balance accounts and non numeric amounts reject the file with the row number. Empty cells are zero. Amounts accept `1 234,50`, `1.234,50` and `1234.50` and are rounded to 2 decimals. Income and costs are positive, reductions negative (ReAI convention).

## ReAI API

Contract: https://app.reai.no/openapi/public (version v1). Endpoints used:

- `GET /api/company-budgets/{year}`: `version` for optimistic locking (`null` for a never saved year); also the live view (`accounts[].amounts`, `currencyCode`).
- `PUT /api/company-budgets/{year}` (`CompanyBudgetReq`: `version`, `accounts[{ accountNumber, amounts[12] }]`, at most 500 accounts). Atomic replace of the whole year: accounts not in the file become zero. A stale version returns 409, shown as is.

## Subrequests per action

Upload: 2 (GET version, PUT). Live view: 1.

## Caveats

- Year must be 1900 to 2100 (contract bounds).
- Only a 404 on the version read is treated as a new year; other errors are shown.
- ReAI validates that each account exists in the company's chart of accounts.

Last verified: 2026-11-28.
