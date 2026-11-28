---
title: "Mollie & Accounting Integration"
seoTitle: "Mollie Settlement Reconciliation for ReAI"
description: "Match Mollie payouts against bank transactions in ReAI and download a reconciliation CSV. Free and open source."
summary: "Fetch Mollie settlements through the Settlements API and match each payout against a pending bank transaction in ReAI."
industry: payments
webAppUrl: /app/mollie/
sourcePath: web/worker/apps/mollie/
highlights:
  - "Reads Mollie settlements with an advanced access token"
  - "Shows the payout, payment volume and costs of each settlement"
  - "Matches payouts against pending ReAI bank transactions within 8 days"
---

## What moves into ReAI

The integration lists every Mollie settlement paid out in the chosen month in the company currency, with the payout, the payment volume and the costs Mollie deducted. Each payout is matched against pending transactions on the bank account you choose in ReAI: same amount within 8 days, and the settlement reference when it appears in the bank text.

Nothing is booked. You get a reconciliation table and a CSV to attach or use when you book Mollie payouts and costs in ReAI, usually between the bank account (`1920`) and the clearing account you use for Mollie. The sales themselves come from your webshop.

## Setup

1. Log in to Mollie as an admin and open **Developers → API keys**.
2. Create an advanced access token with the **settlements.read** permission and copy it. It is shown only once.
3. Click **Open integration**, connect ReAI, choose the bank account and month, and paste the token.

The token is used only for that request and is never stored.
