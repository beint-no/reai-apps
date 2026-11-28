---
title: "PrestaShop & Accounting Integration"
seoTitle: "PrestaShop Accounting Integration for ReAI — Free Product & Sales Sync"
description: "Sync PrestaShop products and paid orders into ReAI using the built-in PrestaShop Webservice API. Zero integration fee."
summary: "Fetch PrestaShop catalog items and paid orders via the Webservice API and sync them into ReAI."
industry: ecommerce-logistics
webAppUrl: /app/prestashop/
sourcePath: web/worker/apps/prestashop.js
highlights:
  - "Connects directly to PrestaShop Webservice API (JSON output)"
  - "Matches product references/SKUs against ReAI before creating items"
  - "Idempotent sales import with zero third-party middleware"
---

## PrestaShop product and sales sync for ReAI

Use PrestaShop's built-in Webservice API to keep ReAI updated with new catalog items and paid online orders—with zero monthly connector fees and no plugins to maintain inside PrestaShop.

## Step-by-step setup

1. In PrestaShop Back Office, open **Advanced Parameters → Webservice**, enable the Webservice and generate a key with `GET` permission on `products` and `orders`.
2. Open the integration above, connect your ReAI company, and enter your store URL and Webservice key.
3. Review new SKUs and paid orders, then sync straight to ReAI.
