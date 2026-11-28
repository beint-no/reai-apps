---
title: "Baemingo & Accounting Integration"
seoTitle: "Baemingo POS Accounting Integration for ReAI: Daily Sales"
description: "Total a Baemingo business day of orders, refunds and tips into one ReAI review voucher with sales per VAT rate and payments per method. Free and open source."
summary: "Fetch one Baemingo business day through the public API and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/baemingo/
sourcePath: web/worker/apps/baemingo.js
highlights:
  - "Reads orders, refunds and tip corrections from the Baemingo public API with your x-api-key"
  - "Splits sales by VAT rate and payments by method, with tips on a payable account"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

Baemingo returns one business day at a time, from 04:00 UTC on the chosen date to 04:00 UTC the next day. The integration adds up every order, refund and tip correction in that day and shows one voucher.

| Line | Account in ReAI |
| --- | --- |
| Cash payments | `1900` |
| Card, Vipps and other payments, including tips paid by card | `1580` clearing |
| Sales including VAT at 25 %, 15 % and 12 % | `3000`, `3010` and `3020` with the ReAI output VAT code |
| Staff tips | `2930` |

Refunds are counted on the day they were made, as Baemingo reports them. Service fees and any rounding go to the largest VAT rate of the order, so each order balances. Check this against the Baemingo Z-report before you book.

## Setup

1. In Baemingo Admin, open **Integrations → Public API** (`admin.baemingo.com/integrations/api`) and generate an API key. The key is shown once and belongs to one venue.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the key and the business day, then fetch.
4. Check the preview, tick the confirmation box and create the review voucher. Attach the Baemingo Z-report in ReAI.

The key is used only for that request and is never stored.
