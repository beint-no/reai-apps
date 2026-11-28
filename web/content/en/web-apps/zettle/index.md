---
title: "Zettle (PayPal POS) & Accounting"
seoTitle: Zettle Accounting Integration for ReAI — POS Payout Reconciliation
description: Compare Zettle by PayPal payouts against ReAI bank transactions for free. Guide to reconciling POS terminal deposits and fees in Norwegian accounting.
summary: Match Zettle Finance v2 liquid-account payouts against pending ReAI bank transactions and export CSV.
industry: payments
webAppUrl: /app/zettle/
sourcePath: web/worker/apps/zettle.js
highlights:
  - "Reads Zettle Finance API v2 payouts using a READ:FINANCE key"
  - "Matches terminal payouts against ReAI bank transactions within an 8-day window"
  - "Includes instant sample preview and formula-safe CSV export"
---

## Reconciling Zettle POS payouts

Zettle collects card sales into your liquid account, deducts card processing fees and pays out net settlements to your business bank. Reconciling monthly payouts against ReAI's bank feed verifies that every POS deposit arrived intact and gives your accountant a clean trail from Z-reports to bank account `1920`.
