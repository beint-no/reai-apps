---
title: "Walley & Accounting Integration"
seoTitle: "Walley Settlement Reconciliation for ReAI"
description: "Match Walley settlement payouts against ReAI bank transactions and download a reconciliation CSV. Free and open source."
summary: "Fetch Walley settlements through the Reports API and match each payout to a pending ReAI bank transaction."
industry: payments
webAppUrl: /app/walley/
sourcePath: web/worker/apps/walley/
highlights:
  - "Reads Walley settlements with a Merchant Hub API key"
  - "Shows payout amount, Walley fees and settlement period per payout"
  - "Matches payouts against pending ReAI bank transactions within 8 days"
---

## What moves into ReAI

The integration lists every Walley settlement paid out in the chosen month, with the paid amount, the Walley fees (compensations), the store and the period the settlement covers. Each payout is matched against pending transactions on the ReAI bank account you choose: same amount within 8 days, and the settlement reference when your bank text contains it.

Nothing is booked. You get a reconciliation table and a CSV file to attach or use when you book the Walley payouts and fees in ReAI, typically between the bank account (`1920`) and your Walley clearing account.

## Setup

1. Log in to Walley Merchant Hub, click your name in the top right menu and choose **Manage Organization**.
2. Choose **Create new** and then **Api key**, fill out the form and select **Create**.
3. Copy the client ID and the secret. The secret is shown only once.
4. Click **Open integration**, connect your ReAI company, choose the bank account and month, and paste the client ID and secret.

The client ID and secret are used only for this request and are never stored.
