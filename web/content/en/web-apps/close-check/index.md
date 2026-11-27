---
title: Month-End Close Checker
seoTitle: ReAI Month-End Close Checker — Automated closing checklist
description: Inspect ReAI accounting period locks, pending bank transactions, manual vouchers awaiting review and supplier invoice tasks in one scan.
summary: Read-only month-end checklist across bank, vouchers, period locks and supplier tasks.
industry: operations
status: maintained
webAppUrl: /app/close-check/
sourcePath: web/worker/apps/close-check.js
highlights:
  - "Checks accounting period locks, pending bank feeds, voucher review queues and supplier tasks in parallel"
  - "100% read-only with direct deep links into app.reai.no for every open item"
  - "Includes a 1-click synthetic sample report so anyone can preview immediately"
---

## Six Public API checks in parallel

Calls `/api/company-settings`, `/api/accounting-periods`, `/api/company-banks`, `/api/bank-reconciliations`, `/api/vouchers` and `/api/supplier-invoices/tasks` server-to-server through the same-origin Worker.
