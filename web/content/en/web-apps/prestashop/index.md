---
title: "PrestaShop & Accounting Integration"
seoTitle: "PrestaShop Accounting Integration for ReAI: Products and Orders"
description: "Create PrestaShop products in ReAI and turn valid store orders into draft orders, using the built-in PrestaShop Webservice. Free and open source."
summary: "Read products and valid orders from the PrestaShop Webservice and move them into ReAI."
industry: ecommerce-logistics
webAppUrl: /app/prestashop/
sourcePath: web/worker/apps/prestashop.js
highlights:
  - "Uses the PrestaShop Webservice that ships with the store, no extra module"
  - "Compares each product reference with the SKUs in ReAI"
  - "Creates draft orders with a fixed external reference per order, so an order is not imported twice"
---

## What moves into ReAI

The integration reads your PrestaShop products and the latest valid orders, together with the customer on each order. Products whose reference is not in ReAI can be created with their price excluding VAT. An order can become a draft order when its customer exists in ReAI with the same email or name.

| From PrestaShop | In ReAI |
| --- | --- |
| Product with reference and price | Product with SKU and selling price |
| Valid order | Draft order with one line for the order total excluding VAT and external reference `prestashop-<id>` |

Check the VAT code and currency on the draft order before you invoice.

## Setup

1. In the PrestaShop back office, open **Advanced Parameters → Webservice** and enable the webservice.
2. Add a key with `GET` access to `products`, `orders` and `customers`, and copy it.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the store address and the key, then click **Scan PrestaShop**.
5. Create new products and click **Stage order** on the orders you want to invoice.

The key is used only for that scan and is never stored.
