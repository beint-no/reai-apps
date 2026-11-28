---
title: "Wix & Accounting Integration"
seoTitle: "Wix Accounting Integration for ReAI: Paid Store Orders"
description: "Fetch paid Wix orders and stage them as ReAI orders with item lines, shipping and VAT rate. Free and open source."
summary: "Fetch paid Wix orders for a period and stage them as orders in ReAI."
industry: ecommerce-logistics
webAppUrl: /app/wix/
sourcePath: web/worker/apps/wix/
highlights:
  - "Reads paid orders through the Wix eCommerce API with an API key and site ID"
  - "One order line per item and for shipping, with the VAT rate Wix charged"
  - "Finds or creates the customer and skips orders that are already staged"
---

## What moves into ReAI

The integration fetches paid and partly refunded orders created in the chosen period, counted in Norwegian calendar days. Test orders and archived orders are left out. Each order is shown with its item, shipping and additional fee lines, excluding VAT and after discounts. Click **Stage in ReAI** to create a ReAI order that you review before invoicing.

| From Wix | In ReAI |
| --- | --- |
| Item line | Order line with quantity, price excluding VAT and the VAT code for the rate Wix charged |
| Shipping | Separate order line with the shipping VAT rate |
| Additional fee | Separate order line with the fee VAT rate |
| Buyer | Customer matched by email or name, or a new customer |
| Order ID | External reference, so the same order is not staged twice |

## Setup

1. Open the **API Keys Manager** in your Wix account and create an API key that can read Wix eCommerce orders for the site.
2. Copy the site ID from the URL of the site dashboard. It follows `/dashboard/`.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the site ID and API key, choose the period and fetch the orders.
5. Check the lines and stage the orders you want to invoice or book in ReAI.

Partly refunded orders are flagged and staged at the full sale. Book the refund as a credit note in ReAI.

The API key is used only for that request and is never stored.
