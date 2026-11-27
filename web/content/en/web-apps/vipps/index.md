---
title: Vipps Reconcile
seoTitle: ReAI Vipps Reconcile — Match Vipps payouts against ReAI bank
description: Compare Vipps MobilePay scheduled payouts against pending ReAI bank transactions for any month and download a CSV report.
summary: Match Vipps Report API payouts with pending ReAI bank transactions and export CSV.
industry: payments
status: example
webAppUrl: /app/vipps/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Calls Vipps Report API v2 on demand without storing sales-unit credentials"
  - "Matches payouts against pending ReAI bank transactions within an 8-day window"
  - "Read-only review with formula-safe CSV export and built-in sample preview"
icon: icons/vipps.avif
---

## Read-only Vipps payout review

Uses the shared reconciliation engine in `web/worker/lib/reconcile.js` without creating automatic accounting postings.
