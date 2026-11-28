---
title: "Magento / Adobe Commerce & Accounting"
seoTitle: "Magento 2 and Adobe Commerce Integration for ReAI: Products and Orders"
description: "Create missing ReAI products by SKU and stage Magento 2 or Adobe Commerce orders as ReAI orders. Free and open source."
summary: "Read products and invoiced orders from Magento 2 or Adobe Commerce and create products and orders in ReAI."
industry: ecommerce-logistics
webAppUrl: /app/magento/
sourcePath: web/worker/apps/magento/
highlights:
  - "Reads products and orders through the Magento REST API with an integration token"
  - "Creates products missing in ReAI with SKU, price and stock item flag"
  - "Skips SKUs and orders that already exist in ReAI"
---

## What moves into ReAI

The integration reads the product catalog and orders with state **processing** or **complete** from the chosen date. You see everything before anything is sent to ReAI.

| From Magento | In ReAI |
| --- | --- |
| Product with SKU, name and price | Product with the same SKU, created only when you click **Create in ReAI** |
| Order with grand total | Order with one line, amount excluding VAT (grand total minus tax), external reference `magento-<id>` |

Each order is linked to a ReAI customer with the same email or name. If the customer is missing, create it in ReAI first. Product prices are taken as Magento stores them, so check whether your store uses prices including or excluding VAT.

## Setup

1. In Magento Admin, open **System → Extensions → Integrations**, click **Add New Integration**, grant read access to **Catalog** and **Sales**, save and click **Activate**. Copy the **Access Token**.
2. On Magento 2.4.4 or later, set **Stores → Configuration → Services → OAuth → Consumer Settings → Allow OAuth Access Tokens to be used as standalone Bearer tokens** to **Yes**.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the store address, the token and the date, and click **Scan**.
5. Create missing products and stage the orders you want to invoice.

The token is used only for that request and is never stored.
