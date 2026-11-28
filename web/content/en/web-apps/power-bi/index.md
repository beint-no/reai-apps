---
title: "Power BI & Accounting"
seoTitle: "Power BI and Excel Feed for ReAI Accounting Data"
description: "Generate Power Query scripts that load ReAI ledger postings, profit and loss, balances and invoices into Power BI or Excel with your own ReAI user API key."
summary: "Copy ready Power Query M scripts for ReAI postings, P&L, balances and invoices into Power BI Desktop, the Power BI service or Excel."
industry: operations
icon: icons/power-bi.svg
webAppUrl: /app/power-bi/
sourcePath: web/worker/apps/power-bi.js
highlights:
  - "Power BI and Excel call the ReAI API directly with your key; apps.reai.no never sees it"
  - "Postings, profit and loss by account class, balances and paginated invoices"
  - "Static data source URL, so scheduled refresh works in the Power BI service"
---

## What the feed loads

The page generates one Power Query M script per dataset. Each script calls the ReAI public API from Power BI or Excel and returns a typed table.

| Query | ReAI endpoint | Content |
| --- | --- | --- |
| `ReAI_Postings` | `GET /api/ledger/general` | Every posting line in the period with account, voucher, VAT code, amount, project, customer, supplier and employee |
| `ReAI_ProfitAndLoss` | `GET /api/ledger/general` (accounts `3000` to `8999`) | Period movement per result account, grouped by account class (3 income, 4 cost of goods, 5 payroll, 6 and 7 other operating expenses, 8 financial items and tax) |
| `ReAI_Balances` | `GET /api/ledger/general` (accounts `1000` to `2999`) | Closing balance per balance account on the end date |
| `ReAI_Invoices` | `GET /api/invoices` | Invoices and credit notes issued in the period with totals, VAT, paid and outstanding amounts |
| `ReAI_Companies` | `GET /api/me` | Companies your key can access and their tenant IDs |

Amounts follow the ledger: debit is positive and credit is negative. The profit and loss query adds `resultAmount`, where income is positive and costs are negative. Nothing is written to ReAI.

## How authentication works

The ReAI API uses bearer tokens. Each request sends `Authorization: Bearer <key>` and, for company data, `X-Tenant-Id: <tenant ID>`. The scripts read the key from a Power Query parameter called `ReAIToken`, so the key is never part of the script text and never passes through apps.reai.no.

A user API key has the same permissions as your ReAI user in every company you can access, and it does not expire on its own. Create a dedicated key for reporting, keep the report file private, and revoke the key when the report is retired. The key is saved inside the `.pbix` or `.xlsx` file.

## Setup

1. In ReAI, open **Profile → User API keys** ([app.reai.no/user/profile](https://app.reai.no/user/profile#user-access-tokens)) and choose **New user API key**. Copy the key.
2. Click **Open integration**, pick the company (or enter its tenant ID), the period and the datasets, then choose **Generate Power Query scripts**.
3. In Power BI Desktop, go to **Home → Transform data → Manage Parameters → New Parameter**. In Excel, go to **Data → Get Data → Launch Power Query Editor → Manage Parameters**. Name the parameter `ReAIToken`, set the type to Text and paste the key.
4. For each dataset, choose **New Source → Blank Query → Advanced Editor**, paste the script and rename the query to the name shown.
5. When Power BI or Excel asks how to connect to `https://app.reai.no`, choose **Anonymous**. The script sets the Authorization header itself.
6. After publishing to the Power BI service, open the semantic model settings, set the data source credentials to **Anonymous** with **Skip test connection**, and turn on scheduled refresh.

To change the period later, edit `StartDate` and `EndDate` at the top of each script, or turn them into Power Query parameters.
