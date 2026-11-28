---
title: "Amendo & Accounting Integration"
seoTitle: "Amendo POS Accounting Integration for ReAI: Daily Z-reports"
description: "Book Amendo Z-reports in ReAI as review vouchers with sales per VAT rate and payments per method. Free and open source."
summary: "Fetch the Amendo Z-reports for one day and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/amendo/
sourcePath: web/worker/apps/amendo/
highlights:
  - "Reads Z-reports through the ProTouch API v3 that the Amendo back office runs on"
  - "Splits sales by VAT rate, net of returns, and payments by payment type"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

The integration reads the Z-reports (dagsoppgjør) signed on the chosen day and adds up their VAT turnover and payment turnover.

| Line | Account in ReAI |
| --- | --- |
| Cash (`Kontant`) | `1900` |
| Card, Vipps, invoice and other payment types | `1580` clearing |
| Sales including VAT at 25 %, 15 % and 12 %, less returns | `3000`, `3010` and `3020` with the ReAI output VAT code |

ReAI splits each sales amount into taxable base and output VAT. If the payments and sales do not balance, for example because of gift cards or rounding, the preview shows the difference and booking stays blocked.

## Setup

1. Ask Amendo support for API access. Amendo issues an API **username**, **password** and **API key** on request to existing customers. The API may need the integration module enabled on your account.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the three credentials and the Z-report date, then fetch.
4. Check the preview against the Z-report under **Rapporter → Dagsoppgjør** in the back office, tick the confirmation box and create the review voucher.

The credentials are used only for that request and are never stored.
