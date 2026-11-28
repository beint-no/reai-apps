# Power BI Feed

Route `/app/power-bi/`. Docs pages: `web/content/{nb,en}/web-apps/power-bi/index.md`.

This app works with ReAI data or files only; it calls no third-party API.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/invoices`
- `/api/ledger/general`

## Caveats

ReAI side helper: generates one self-contained Power Query M script per dataset (ReAI_Postings, ReAI_ProfitAndLoss (accounts 3000-8999, NS 4102 class grouping, resultAmount = -amount), ReAI_Balances (1000-2999 closingBalance on end date via startDate=endDate), ReAI_Invoices (List.Generate over page/pageSize=200 until hasNext false, cap 500 pages), ReAI_Companies (/api/me tenant IDs)). Web.Contents uses a static base URL with RelativePath + Query so Power BI service scheduled refresh works with Anonymous credentials and Skip test connection. Optional ReAI session (device flow) only fills the company list and a read-only preview (ledger counts, period result, invoice totalItems). Also offers .pq download. Manually created user API keys are unbound to a company, inherit the user's full permissions and do not expire; docs warn the key is saved in the .pbix/.xlsx. Overlaps conceptually with existing /app/export/ (CSV/JSON export). No vendor contact (Microsoft product). /api/postings (paginated, ids only) would be an alternative for very large ledgers; ledger/general was chosen because it carries account and party names. M scripts were not executed in Power BI (no Windows/Power BI here); syntax checked by review only.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
