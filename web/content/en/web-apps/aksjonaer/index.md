---
title: "Share investments from CSV"
seoTitle: "Share investments from CSV to ReAI | Free open source integration"
description: "Register share holdings from a portfolio file in ReAI Share Investments, matched to the ReAI securities catalogue by ISIN."
summary: "Register share holdings from a portfolio file in ReAI and review the holdings already there."
industry: operations
webAppUrl: /app/aksjonaer/
sourcePath: web/worker/apps/aksjonaer/
highlights:
  - "Matches each holding to the ReAI securities catalogue by ISIN"
  - "Skips holdings that already exist in ReAI"
  - "Sets the exemption method only when the file says so"
---

## What moves into ReAI

The app reads a CSV with one row per holding and registers it in ReAI Share Investments:

| Column in the file | In ReAI |
| --- | --- |
| Name (required) | Holding name |
| ISIN | Matched to the ReAI securities catalogue |
| Type: listed, unlisted, fund, bond or other | Instrument type, needed when the ISIN is not in the catalogue |
| Account | Balance sheet account, such as `1350` or `1810` |
| Quantity, cost and date | Opening position |
| Exemption: yes or no | Within the exemption method; empty means not assessed |

Holdings with the same ISIN, or the same name without an ISIN, that already exist in ReAI are not registered again. The app creates no vouchers.

## Getting started

1. Make a CSV with the columns above. Numbers may use comma or point as the decimal separator.
2. Open the app, click **Connect to ReAI** and choose a company.
3. Upload the file, check the preview and click **Register** for each holding.

Import Nordnet transactions in ReAI under Share investments. Review the exemption method for each holding before sales or dividends.
