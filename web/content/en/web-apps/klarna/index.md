---
title: "Klarna & Accounting Integration"
seoTitle: Klarna Accounting Integration for ReAI — Settlement Reconciliation
description: Match Klarna settlement payouts against ReAI bank transactions for free. Complete guide to booking Klarna sales, returns, fees and net bank deposits.
summary: Compare Klarna Settlements API payouts with pending ReAI bank transactions and export a reconciliation CSV.
industry: payments
icon: icons/klarna.svg
webAppUrl: /app/klarna/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Reads Klarna Settlements v1 payouts with sales, fees and returns breakdown"
  - "Automatically finds matching ReAI bank transactions by payment reference or amount"
  - "Free to use with ReAI — zero per-order or monthly connector charges"
---

## How Klarna settlements work in accounting

Klarna batches captures, customer refunds and merchant fees into periodic settlement payouts. Each payout carries a `payment_reference` that normally appears on your bank statement. Matching `settlement_amount` against bank account `1920` while reconciling gross sales (`3000`), refunds and Klarna fees (`7770`, VAT code `0`) keeps your `1580` clearing account at zero after every settlement.

## Connecting Klarna to ReAI

1. Generate an API credential (`klarna_live_api_…`) in the Klarna Merchant Portal with settlement read access.
2. Open the Klarna app, connect your ReAI company, pick your bank account and payout month, and click **Review Klarna payouts**.
3. Export the matched CSV report for your monthly bookkeeping documentation.
