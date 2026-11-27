---
title: Klarna Reconcile
seoTitle: ReAI Klarna Reconcile — Match Klarna settlements against ReAI bank
description: Compare Klarna settlement payouts against pending ReAI bank transactions on demand and export a reconciliation CSV.
summary: Compare Klarna Settlements API payouts with pending ReAI bank lines and export CSV.
industry: payments
status: example
webAppUrl: /app/klarna/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Reads Klarna Settlements v1 payouts on demand without storing your API key"
  - "Highlights reference + amount matches against pending ReAI bank transactions"
  - "Includes synthetic sample mode and CSV export"
icon: icons/klarna.avif
---

## Klarna settlement matching

Paste a Klarna Merchant Portal API key for a single on-demand review session and export the matched rows to CSV.
