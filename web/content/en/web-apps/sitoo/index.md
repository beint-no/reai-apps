---
title: "Sitoo POS Z-reports and accounting"
seoTitle: "Sitoo POS Z-reports to ReAI | Free open source integration"
description: "Fetch the day's Sitoo POS Z-reports and create a balanced review voucher in ReAI with payments by tender and sales by Norwegian VAT rate."
summary: "Turn Sitoo POS Z-reports into one balanced ReAI review voucher per day, with ReAI output VAT codes."
industry: operations
webAppUrl: /app/sitoo/
sourcePath: web/worker/apps/sitoo.js
highlights:
  - "Reads POS Z-reports from the Sitoo REST API with your API ID and password"
  - "Splits sales by 25, 15, 12 and 0% VAT using ReAI output VAT codes"
  - "Creates a review voucher you approve in ReAI; credentials are never stored"
---

## What moves into ReAI

For the date you choose, the app reads every POS Z-report closed that day in Sitoo (`GET /v2/accounts/{account}/pos-z-reports`) and combines them into one review voucher in ReAI:

| Sitoo Z-report | ReAI account | VAT code |
| --- | --- | --- |
| Cash payments | `1900` | 0 |
| Card, Vipps and other tenders | `1580` | 0 |
| Gift card payments | `2900` | 0 |
| Invoice payments | `1570` | 0 |
| Sales 25% VAT, incl. VAT | `3000` | 3 |
| Sales 15% VAT, incl. VAT | `3010` | 31 |
| Sales 12% VAT, incl. VAT | `3020` | 33 |
| Sales 0% VAT | `3100` | 5 |
| Rounding | `7790` | 0 |

Refunds are posted against the same accounts. ReAI splits each sales line into net revenue and output VAT from the VAT code, so the VAT return picks up the turnover. The voucher is flagged for review and is only created when payments and sales balance. A second booking of the same day is blocked.

## Setup

1. In Sitoo Backoffice, open **Settings / Sitoo REST API**. You need Administrator rights and the API extension on your account.
2. Generate a password for the API user. Copy the **API ID**, the **password**, the **base URL** and your **account ID** shown there.
3. If you restrict the API key to specific IP addresses, allow requests from the ReAI apps service or remove the restriction for this key.
4. Open the app, click **Connect to ReAI** and choose the company.
5. Enter the Sitoo details and the Z-report date, click **Fetch from Sitoo API**, check the preview and create the review voucher.

Only NOK registers with Norwegian VAT rates are supported. Check the voucher against the Z-report PDFs and attach them in ReAI.
