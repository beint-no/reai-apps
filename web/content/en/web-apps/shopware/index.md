---
title: "Shopware 6 & Accounting Integration"
seoTitle: "Shopware 6 Accounting Integration for ReAI — Free Product & Sales Sync"
description: "Sync Shopware 6 products and paid orders into ReAI via Shopware OAuth client credentials. Included free with ReAI."
summary: "Authenticate with Shopware 6 Admin API to sync products by SKU and import paid orders into ReAI."
industry: ecommerce-logistics
webAppUrl: /app/shopware/
sourcePath: web/worker/apps/shopware.js
highlights:
  - "Authenticates cleanly via Shopware 6 /api/oauth/token client credentials"
  - "Reads product catalog and paid orders via Shopware Search API"
  - "Syncs missing SKUs and imports orders idempotently into ReAI"
---

## Shopware 6 integration for Norwegian accounting

Connect your Shopware 6 storefront directly to ReAI using a native Shopware Integration credential—syncing products by `productNumber` (SKU) and importing paid orders into ReAI without middleware.

## Step-by-step setup

1. In Shopware 6 Admin, open **Settings → System → Integrations** and create an integration with read access to Products and Orders.
2. Open the integration above, connect your ReAI company and paste your Store URL, Access Key ID and Secret Access Key.
3. Scan and sync new products and paid orders directly into ReAI.
