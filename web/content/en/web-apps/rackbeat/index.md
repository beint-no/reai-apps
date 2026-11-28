---
title: "Rackbeat & Accounting Integration"
seoTitle: "Rackbeat Products to ReAI Products"
description: "Compare the Rackbeat product register with ReAI Products by SKU and create missing products with prices and barcode. Free and open source."
summary: "Read Rackbeat products through the REST API and create the missing ones in ReAI Products."
industry: ecommerce-logistics
webAppUrl: /app/rackbeat/
sourcePath: web/worker/apps/rackbeat/
highlights:
  - "Reads sellable Rackbeat products with a personal API key"
  - "Matches the Rackbeat product number against ReAI SKUs"
  - "Creates missing ReAI products with sales price, cost price and barcode"
---

## What moves into ReAI

The integration reads the sellable Rackbeat products that are not barred and compares the product number with the SKUs in ReAI Products. For each missing product you can create a ReAI stock item with the Rackbeat name as title, the product number as SKU, and the sales price, cost price and barcode from Rackbeat. Products already in ReAI are left unchanged.

Rackbeat stock quantities are shown for reference only. No stock movements, vouchers or orders are created, and the revenue account and VAT code follow your ReAI product defaults.

## Setup

1. In Rackbeat open **Company settings > API** and create a new key with a name such as ReAI. The integration only reads products.
2. Copy the key right away. Rackbeat shows it only once.
3. Click **Open integration**, connect your ReAI company, paste the key and click **Scan Rackbeat products**.
4. Click **Create in ReAI** on the products you want.

The key is used only for the scan and is never stored.
