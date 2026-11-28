---
title: "Svea Checkout & Accounting Integration"
seoTitle: "Svea Checkout Payout Reconciliation for ReAI"
description: "Match daily Svea Checkout payouts against ReAI bank transactions and download a reconciliation CSV. Free and open source."
summary: "Fetch Svea reconciliation reports for each day of a month and match every payout to a pending ReAI bank transaction."
industry: payments
icon: icons/svea.svg
webAppUrl: /app/svea/
sourcePath: web/worker/apps/svea.js
highlights:
  - "Reads the Svea Payment Admin API reconciliation report for each payout date"
  - "Shows the paid amount, Svea fees with VAT and the number of transactions"
  - "Matches payouts against pending ReAI bank transactions within 8 days"
---

## What moves into ReAI

Svea creates one reconciliation report per payout date. The integration reads the reports for every past day of the chosen month and shows the amount Svea paid to your bank account (including withholding and opening debt), the Svea fees including VAT and the number of transactions in the payout. Each payout is matched against pending transactions on the ReAI bank account you choose: same amount within 8 days.

Nothing is booked. The reconciliation table and CSV file give you the basis for booking Svea payouts and fees in ReAI, typically between the bank account (`1920`) and your Svea clearing account.

## Setup

1. Find the Checkout merchant ID and secret key that Svea issued for your Svea Checkout agreement. If you do not have them, ask Svea.
2. Ask Svea to activate reconciliation reports for your merchant if they are not active. The report is available when Svea is your payment facilitator.
3. Click **Open integration**, connect your ReAI company, choose the bank account and month, and enter the merchant ID and secret key.

The secret key only signs the requests and is never stored.
