---
title: "Budget import from CSV"
seoTitle: "Budget from CSV to ReAI | Free open source integration"
description: "Upload a monthly budget per result account from Excel or CSV to ReAI and review the saved budget by quarter."
summary: "Upload a monthly budget per result account to ReAI and review the saved budget by quarter."
industry: operations
webAppUrl: /app/budget/
sourcePath: web/worker/apps/budget/
highlights:
  - "Saves a whole budget year in ReAI at once"
  - "Accepts Norwegian number formats"
  - "Shows the saved budget by quarter"
---

## What moves into ReAI

The file has the account number in the first column and one amount per month from January to December. Only result accounts (3000 to 8999) are accepted. Income and costs are positive amounts, reductions negative.

The app replaces the whole budget year in ReAI. Accounts that are not in the file get a zero budget. If someone changed the budget in ReAI during the upload, it is rejected and you can try again.

## Getting started

1. Save the budget from Excel as CSV with a header row.
2. Open the app, click **Connect to ReAI** and choose a company.
3. Choose the year, upload the file and click **Replace budget in ReAI**.
4. Click **Load live ReAI budget** to check the result.
