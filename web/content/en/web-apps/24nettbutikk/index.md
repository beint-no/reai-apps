---
title: "24Nettbutikk & Accounting Integration"
seoTitle: "24Nettbutikk and ReAI: products and paid orders"
description: "Fetch products and paid orders from the 24Nettbutikk API and move them to ReAI with the correct VAT rates."
summary: "Create missing products in ReAI and stage paid 24Nettbutikk orders as ReAI orders."
industry: ecommerce-logistics
webAppUrl: /app/24nettbutikk/
sourcePath: web/worker/apps/24nettbutikk.js
highlights:
  - "Reads products, paid orders and customers from the 24Nettbutikk API"
  - "Uses the VAT rate of each order line from the shop"
  - "Blocks duplicates by SKU and order number"
---

## Products and orders from 24Nettbutikk

The integration fetches the products and the paid orders for one month from 24Nettbutikk. Products missing in ReAI can be created with one click. Paid orders become ReAI orders with the same lines and VAT rates as in the shop, and the order number is stored as the external reference so the same order cannot be added twice.

The ReAI customer is matched by organisation number or email address. Orders paid partly with a gift card must be booked by hand.

Pair it with the [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/) and [Nets Easy](/web-apps/nets/) reconcilers.

## Setup

1. Sign in to 24Nettbutikk, click your name and choose **API Nøkler**.
2. Click **Generer tilfeldig kode** and copy the key. It is shown only once.
3. Click **Open integration**, connect ReAI and enter the shop address, the API key and the month.
4. Review the products and orders and move them to ReAI.
