---
title: "Upsales & Accounting Integration"
seoTitle: "Upsales Won Orders to ReAI | Free Integration"
description: "Fetch won Upsales orders through the API and stage them as draft orders in ReAI with their order rows, with customers created from the Upsales companies. Free and open source."
summary: "Stage won Upsales orders as ReAI orders and create the missing customers."
industry: operations
webAppUrl: /app/upsales/
sourcePath: web/worker/apps/upsales/
highlights:
  - "Reads won orders in a period through the Upsales API"
  - "Keeps the order rows when they add up to the order value"
  - "Stages each order once, with a duplicate check in ReAI"
---

## What moves into ReAI

The integration reads won orders in Upsales dated in the period you choose, together with their companies. Companies are matched against ReAI customers by organisation number or name, and you create the missing ones with one click. Each order can then be staged as a draft order in ReAI.

| From Upsales | In ReAI |
| --- | --- |
| Company with name, organisation number and address | Customer |
| Won order with currency and order rows | Draft order with the same lines |
| Order id | External reference that stops duplicates |

Prices are used excluding VAT, and ReAI applies the customer's default VAT code. If the rows do not add up to the order value, the order gets one line with the order value. Check the order before you invoice.

## Set up Upsales with ReAI

1. In Upsales, an admin activates the API under **Settings → Account → Billing portal → Products** if it is not active.
2. Go to **Settings → Account → Security → API keys**, create a new key and copy it.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the key, choose the period and fetch.
5. Create the missing customers, fetch again and click **Stage order** for each order.

The key is used only for these requests and is never stored.
