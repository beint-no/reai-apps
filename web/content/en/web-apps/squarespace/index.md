---
title: "Squarespace & Accounting Integration"
seoTitle: "Squarespace Accounting Integration for ReAI: Store Orders"
description: "Fetch Squarespace Commerce orders and stage them as ReAI orders with item lines, shipping and VAT. Free and open source."
summary: "Fetch Squarespace orders for a period and stage them as orders in ReAI."
industry: ecommerce-logistics
webAppUrl: /app/squarespace/
sourcePath: web/worker/apps/squarespace/
highlights:
  - "Reads orders through the Squarespace Orders API with a developer API key"
  - "One order line per item, shipping and discount, excluding VAT"
  - "Finds or creates the customer and skips orders that are already staged"
---

## What moves into ReAI

The integration fetches orders created in the chosen period and leaves out canceled orders. Squarespace reports tax per order, so the integration derives the order rate and applies it to every line when it is 25, 15, 12 or 0 percent. Otherwise the lines get the ReAI default VAT code. Click **Stage in ReAI** to create a ReAI order that you review before invoicing.

| From Squarespace | In ReAI |
| --- | --- |
| Item line | Order line with quantity and price excluding VAT |
| Shipping and discount | Separate order lines |
| Buyer | Customer matched by email or name, or a new customer |
| Order ID | External reference, so the same order is not staged twice |

## Setup

1. In Squarespace open **Settings → Advanced → Developer API Keys**, click **Generate Key** and give the key the **Orders** permission. Developer API keys require a Commerce plan.
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the API key, choose the period and fetch the orders.
4. Check the lines and VAT rate, and stage the orders you want to invoice or book in ReAI.

The API key is used only for that request and is never stored.
