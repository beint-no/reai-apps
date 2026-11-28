---
title: "Caspeco & Accounting Integration"
seoTitle: "Caspeco POS Accounting Integration for ReAI: Daily Sales"
description: "Total a Caspeco business day of POS sales into one ReAI review voucher with sales per VAT rate, payments per type and tips. Free and open source."
summary: "Fetch one Caspeco business day through the Sales Export API and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/caspeco/
sourcePath: web/worker/apps/caspeco/
highlights:
  - "Reads sales lines from the Caspeco Sales Export API with the AuthKey from Caspeco"
  - "Derives the VAT rate per line and groups payments by Caspeco payment type"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

Caspeco returns every sales line in the business day, from 06:00 on the chosen date to 05:59 the next morning. The integration adds sales including VAT per rate, groups the same amounts by payment type and counts each receipt's tip once.

| Line | Account in ReAI |
| --- | --- |
| Cash payments | `1900` |
| Card and other payment types, including tips | `1580` clearing |
| Sales including VAT at 25 %, 15 % and 12 % | `3000`, `3010` and `3020` with the ReAI output VAT code |
| Staff tips | `2930` |

Caspeco gives one payment type per sales line, so a receipt split between several payment types is grouped under the type on its lines. Discounts reported by Caspeco are shown in the preview. Compare payments and sales with the Caspeco day report before you book.

## Setup

1. Ask Caspeco support for access to the **Sales Export API**. Caspeco sends an **AuthKey** and the **system name** for your business.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the AuthKey, the system name and the business day, then fetch. Caspeco allows a limited number of requests per day for each key.
4. Check the preview, tick the confirmation box and create the review voucher.

The key is used only for that request and is never stored.
