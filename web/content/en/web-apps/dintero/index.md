---
title: Dintero Fees
seoTitle: ReAI Dintero Fees — Review withheld fees and book monthly voucher
description: Review withheld Dintero settlement fees, match net payouts against ReAI bank transactions, and create a monthly review voucher.
summary: Review withheld Dintero settlement fees, export CSV and optionally post a review voucher.
industry: payments
status: example
webAppUrl: /app/dintero/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Totals withheld fees across paid Dintero settlements in your company currency"
  - "Optionally compares net payouts with pending ReAI bank transactions and exports CSV"
  - "Creates a review-flagged fee voucher only after duplicate check, account validation and explicit confirmation"
icon: icons/dintero.avif
---

## Fee reconciliation & booking

Checks ReAI for an existing monthly Dintero fee voucher marker before creating any posting, and refuses to book test (`T…`) Dintero accounts.
