---
title: Zettle Reconcile
seoTitle: ReAI Zettle Reconcile — Match Zettle payouts against ReAI bank
description: Compare Zettle liquid-account payouts against pending ReAI bank transactions and download a structured CSV report.
summary: Review Zettle Finance v2 payouts against pending ReAI bank transactions and export CSV.
industry: payments
status: example
webAppUrl: /app/zettle/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Exchanges Zettle READ:FINANCE credentials per review without persisting keys"
  - "Matches POS liquid-account payouts against pending ReAI bank transactions"
  - "Read-only workflow with CSV download and sample preview"
icon: icons/zettle.avif
---

## Point-of-sale payout review

Matches Zettle Finance API payouts to candidate ReAI bank transactions without creating automatic ledger entries.
