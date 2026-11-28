---
title: "Front Systems POS & Accounting"
seoTitle: "Front Systems POS Accounting Integration for ReAI — Daily Retail Sales"
description: "Fetch daily retail store sales from Front Systems API v2 and post balanced Z-report review vouchers directly into ReAI for free."
summary: "Pull daily Front Systems store sales by payment type and VAT rate and create a balanced ReAI review voucher."
industry: payments
icon: icons/front-systems.svg
webAppUrl: /app/front-systems/
sourcePath: web/worker/apps/front-systems.js
highlights:
  - "Connects directly to Front Systems API v2 (/v2/Sales) using X-API-Key"
  - "Aggregates cash, card terminal and Vipps payments against 25%/15%/12%/0% VAT sales"
  - "Posts one balanced, duplicate-checked daily review voucher to ReAI"
---

## Direct Front Systems POS integration for retail chains

Front Systems is widely used across Norwegian fashion and retail stores. Instead of manually keying Z-reports or paying for custom middleware, pull any store day straight from the Front Systems API v2 and book a balanced voucher in ReAI.

## Step-by-step setup

1. Copy your Front Systems **X-API-Key** from Front Systems Portal.
2. Open the integration above, connect your ReAI company and choose the sales date.
3. Inspect the aggregated payment and VAT postings, then create the review voucher in ReAI.
