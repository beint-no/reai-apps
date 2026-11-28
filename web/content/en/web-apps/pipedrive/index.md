---
title: "Pipedrive CRM & Accounting Integration"
seoTitle: "Pipedrive CRM Accounting Integration for ReAI — Customers & Won Deals"
description: "Sync Pipedrive CRM organizations into ReAI customers and convert won deals directly into draft ReAI customer orders for free."
summary: "Sync Pipedrive organizations to ReAI customers (with Norwegian org.nr validation) and stage won deals as ReAI orders."
industry: operations
webAppUrl: /app/pipedrive/
sourcePath: web/worker/apps/pipedrive.js
highlights:
  - "Scans Pipedrive Organizations and Won Deals in one click"
  - "Creates missing ReAI customers with built-in Norwegian Mod11 org.nr validation"
  - "Converts won Pipedrive deals into idempotent ReAI draft orders ready to invoice"
---

## Turn won Pipedrive deals into ReAI invoices without re-keying

Sales teams live in Pipedrive while finance works in ReAI. This integration bridges both cleanly: missing organizations become validated ReAI customers, and won deals become draft ReAI orders tagged with `pipedrive-deal-<id>` so nothing is ever invoiced twice.

## Step-by-step setup

1. Copy your personal API token in Pipedrive (**Settings → Personal preferences → API**).
2. Click **Open integration**, connect your ReAI company and scan Pipedrive.
3. Create any missing customers (entering their 9-digit Norwegian org.nr inline) and click **Stage order** on any won deal.
