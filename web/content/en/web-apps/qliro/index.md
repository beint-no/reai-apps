---
title: "Qliro Checkout & Accounting Integration"
seoTitle: "Qliro Settlement Reconciliation for ReAI"
description: "Match Qliro Checkout settlement batches against ReAI bank transactions and download a reconciliation CSV. Free and open source."
summary: "Fetch Qliro settlement batches through the Admin API and match each bank transfer to a pending ReAI bank transaction."
industry: payments
icon: icons/qliro.svg
webAppUrl: /app/qliro/
sourcePath: web/worker/apps/qliro.js
highlights:
  - "Reads Qliro settlement batches with your Qliro Checkout API secret"
  - "Shows batch amount, fee amount and payment provider for each transfer"
  - "Matches batches against pending ReAI bank transactions within 8 days"
---

## What moves into ReAI

Qliro groups settled transactions into batches, one per bank transfer and payment provider (for example Qliro, Nets or Trustly). The integration lists the batches transferred in the chosen month with the total amount, the total fee amount and the batch ID. Each batch is matched against pending transactions on the ReAI bank account you choose: same amount within 8 days, and the batch ID when your bank text contains it.

Nothing is booked. The reconciliation table and CSV file give you the basis for booking Qliro payouts and fees in ReAI, typically between the bank account (`1920`) and your Qliro clearing account.

## Setup

1. Find the production API secret that Qliro issued for your Qliro Checkout store. If you do not have it, ask Qliro store support.
2. Click **Open integration**, connect your ReAI company, choose the bank account and month, and paste the API secret.

The API secret only signs the request and is never sent or stored.
