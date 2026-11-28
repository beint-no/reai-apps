---
title: "Shopware & Accounting Integration"
seoTitle: "Shopware 6 Accounting Integration for ReAI: Paid Orders"
description: "Fetch paid Shopware 6 orders and stage them as ReAI orders with item lines, shipping and VAT rate. Free and open source."
summary: "Fetch paid Shopware orders for a period and stage them as orders in ReAI."
industry: ecommerce-logistics
webAppUrl: /app/shopware/
sourcePath: web/worker/apps/shopware.js
highlights:
  - "Reads paid orders through the Shopware Admin API with an integration"
  - "One order line per item, discount and shipping, with the tax rate Shopware calculated"
  - "Finds or creates the customer and skips orders that are already staged"
---

## What moves into ReAI

The integration fetches orders dated in the chosen period whose payment transaction is *paid*. Prices including VAT are converted to amounts excluding VAT using the tax Shopware calculated for each line. Click **Stage in ReAI** to create a ReAI order that you review before invoicing.

| From Shopware | In ReAI |
| --- | --- |
| Item and discount line | Order line with quantity, price excluding VAT and the VAT code for the rate |
| Shipping | Separate order line with the shipping tax rate |
| Customer | Customer matched by email or name, or a new customer |
| Order ID | External reference, so the same order is not staged twice |

## Setup

1. In the Shopware Administration open **Settings → System → Integrations** and create an integration with read access to orders.
2. Copy the **access key ID** and **secret access key**. The secret is shown only when the integration is created.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the shop URL, the keys and the period, and fetch the orders.
5. Check the lines and stage the orders you want to invoice or book in ReAI.

The keys are used only for that request and are never stored.
