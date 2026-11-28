---
title: "Mystore & Accounting Integration"
seoTitle: "Mystore Integration for ReAI: Products and Orders"
description: "Create Mystore products in ReAI by SKU and move orders across with the matching VAT code. Free and open source."
summary: "Fetch products and the latest orders from the Mystore API and move them into ReAI."
industry: ecommerce-logistics
webAppUrl: /app/mystore/
sourcePath: web/worker/apps/mystore.js
highlights:
  - "Reads products and orders through the Mystore API with a personal access token"
  - "Creates products that are missing in ReAI, matched by SKU"
  - "Creates one ReAI order per Mystore order, with a duplicate check"
---

## What moves into ReAI

The integration fetches products with a SKU and the latest orders from the Mystore API. You choose what to create in ReAI.

| From Mystore | In ReAI |
| --- | --- |
| Product with SKU | Product with the same SKU and its price excluding VAT |
| Order lines | Order lines priced excluding VAT with the output VAT code for the Mystore VAT rate |
| Shipping, fees and discounts | Separate order lines with the VAT rate from Mystore |

The order is linked to the ReAI customer with the same email or name. An order is offered only when its lines add up to the Mystore order total, and each order can be moved only once.

## Setup

1. Log in at [auth.mystore.no](https://auth.mystore.no/login) with your store name and admin user.
2. Open **Personal Access Tokens**, choose **Create New Token** and give the token the scopes `products:read` and `orders:read`. Copy the token, it is shown only once.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the store name and token and scan the store. Create the missing products and move the orders you want to invoice from ReAI.

The token is used only for the scan and is never stored.
