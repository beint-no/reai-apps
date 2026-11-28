---
title: "Mystore.no & Accounting Integration"
seoTitle: "Mystore.no Accounting Integration for ReAI — Free Product & Sales Sync"
description: "Sync Mystore.no products and paid orders directly into ReAI for free. Replace expensive third-party Mystore accounting connectors."
summary: "Sync Mystore.no catalog products by SKU and import paid Mystore orders idempotently into ReAI."
industry: ecommerce-logistics
icon: icons/mystore.svg
webAppUrl: /app/mystore/
sourcePath: web/worker/apps/ecommerce.js
highlights:
  - "Connects directly to the Mystore.no JSON:API (/products and /orders)"
  - "Deduplicates products by SKU and creates missing items in ReAI"
  - "Imports paid orders idempotently via ReAI's invoice import API"
---

## Why connect Mystore.no directly to ReAI?

Mystore.no is one of Norway's largest ecommerce platforms, yet merchants often pay hundreds of NOK per month for separate accounting connectors. ReAI's open-source Mystore web app handles both **product sync** and **sales sync** directly in your browser at zero add-on cost.

| Sync flow | Source (Mystore.no) | Target (ReAI Public API) |
| --- | --- | --- |
| Product sync | `GET /{shop}/products` | `POST /api/products` (matched by SKU) |
| Sales sync | `GET /{shop}/orders` | `POST /api/invoices/import` (idempotent externalId) |

## Step-by-step setup

1. Open **Mystore Kontrollpanel** and generate a Personal Access Token with `products:read` and `orders:read`.
2. Click **Open integration**, connect your ReAI company, pick a fallback webshop customer and product, and scan your store.
3. Create missing SKUs and import paid orders in one click—or test the flow immediately with **Load sample sync**.
