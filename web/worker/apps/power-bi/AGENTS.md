# Power BI Feed

Route `/app/power-bi/`. Docs pages: `web/content/{nb,en}/web-apps/power-bi/index.md`.

## Purpose

Generates Power Query M scripts that Power BI Desktop, the Power BI service or Excel run against
the ReAI public API with the customer's own ReAI user API key. No third-party API is called and the
key never reaches apps.reai.no: the scripts read a Power Query parameter named `ReAIToken`.

## Microsoft docs (M functions used)

- `Web.Contents` (RelativePath, Query, Headers): https://learn.microsoft.com/powerquery-m/web-contents
- Scheduled refresh with dynamic sources: https://learn.microsoft.com/power-bi/connect-data/refresh-data#refresh-and-dynamic-data-sources
- `List.Generate`: https://learn.microsoft.com/powerquery-m/list-generate

## ReAI API

Contract: https://app.reai.no/openapi/public. Auth `Authorization: Bearer <user API key>` and
`X-Tenant-Id` on tenant scoped calls.

Generated scripts:

- `ReAI_Postings`: `GET /api/ledger/general?startDate&endDate` (one call, not paged).
- `ReAI_ProfitAndLoss`: same with `accountFrom=3000&accountTo=8999`; movement = sum of postings,
  `resultAmount = -movement`, grouped by NS 4102 class.
- `ReAI_Balances`: same with `startDate=endDate=end`, `accountFrom=1000&accountTo=2999`, uses
  `closingBalance`.
- `ReAI_Invoices`: `GET /api/invoices?startDate&endDate&page&pageSize=200` (issue date range,
  200 is the documented maximum), `List.Generate` until `hasNext` is false, cap 500 pages;
  `isCreditNote` from `creditedInvoiceId` or `creditedInvoiceIds`.
- `ReAI_Companies`: `GET /api/me` (`tenants[].id`).

Worker side (optional ReAI device flow session): `/preview` makes three parallel calls, two
`/api/ledger/general` and `/api/invoices?pageSize=1` (for `totalItems`). Generate and download make
no subrequests.

## Caveats

- `Web.Contents` keeps a static base URL with RelativePath and Query so the service can refresh with
  Anonymous credentials; untested in the Power BI service here (no Windows), reviewed only.
- User API keys inherit the user's permissions, are not bound to one company and do not expire; the
  key is stored inside the .pbix or .xlsx. The page says so.
- `/api/ledger/general` returns the whole period in one response; very large ledgers could use
  `/api/postings` (paged, fewer names) instead.
- Overlaps with `/app/export/` (CSV and JSON export).

Last verified: 2026-11-28.
