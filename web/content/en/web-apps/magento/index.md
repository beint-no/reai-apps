---
title: "Magento / Adobe Commerce & Accounting"
seoTitle: "Magento 2 & Adobe Commerce Accounting Integration for ReAI"
description: "Connect Magento 2 or Adobe Commerce to ReAI for free product sync (/rest/V1/products) and paid sales sync (/rest/V1/orders)."
summary: "Sync Magento 2 / Adobe Commerce products by SKU and import paid orders directly into ReAI."
industry: ecommerce-logistics
webAppUrl: /app/magento/
sourcePath: web/worker/apps/magento.js
highlights:
  - "Uses standard Magento REST API v1 Integration Bearer tokens"
  - "Syncs SKUs, pricing and stock-item flags straight to ReAI"
  - "Idempotent paid order import with external order ID protection"
---

## Direct Magento 2 / Adobe Commerce integration

Avoid heavy ERP middleware for standard Norwegian ecommerce accounting. Connect Magento 2 directly to ReAI using a read-only Integration token to synchronize your SKU catalog and import paid sales orders cleanly.

## Step-by-step setup

1. In Magento Admin, go to **System → Extensions → Integrations**, add an integration with Catalog and Sales read access, and activate it to get the Access Token.
2. Open the integration above, connect your ReAI company and enter your store HTTPS URL and Bearer token.
3. Sync missing SKUs and import paid orders idempotently into ReAI.
