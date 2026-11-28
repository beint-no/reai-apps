---
title: "PayPal Point of Sale (Zettle) & Accounting"
seoTitle: "PayPal Point of Sale (Zettle) Accounting Integration for ReAI: Payout Reconciliation"
description: "Compare PayPal Point of Sale payouts, formerly Zettle, against pending ReAI bank transactions and export a CSV report. Free and open source."
summary: "Match PayPal Point of Sale (Zettle) payouts against pending ReAI bank transactions and export a CSV report."
industry: payments
webAppUrl: /app/zettle/
sourcePath: web/worker/apps/zettle/
highlights:
  - "Reads payouts through the Finance API with a READ:FINANCE API key"
  - "Matches payouts against ReAI bank transactions within 8 days"
  - "Exports a CSV report for your month end documentation"
---

## Reconciling payouts against the bank

Zettle by PayPal is now called PayPal Point of Sale. Card sales collect in the liquid account, card fees are deducted and the net amount is paid out to your bank account or PayPal account. The integration fetches one month of payouts and matches them against pending ReAI bank transactions by amount, date and reference. Nothing is booked.

## Setup

1. Sign in at **my.zettle.com/apps/api-keys** and create an API key with the **READ:FINANCE** scope. Copy the key and the client ID shown after the key is created.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the client ID, API key and month, and choose the ReAI bank account.
4. Check the matches and download the CSV report.

The key is used only for that request and is never stored.
