---
title: "Nexi Checkout & Accounting Integration"
seoTitle: "Nexi Checkout (formerly Nets Easy) Payout Reconciliation for ReAI"
description: "Fetch Nexi Checkout payouts for one month and reconcile them against bank transactions in ReAI. Free and open source."
summary: "Reconcile Nexi Checkout payouts, formerly Nets Easy, against the bank in ReAI and download the result as CSV."
industry: payments
webAppUrl: /app/nets/
sourcePath: web/worker/apps/nets/
highlights:
  - "Reads payouts from the Nexi Checkout Reporting API with your secret key"
  - "Shows amount, fees and reference for every payout"
  - "Matches payouts against pending bank transactions in ReAI"
---

## What the integration does

The integration reads the payouts for the chosen month from the Nexi Checkout Reporting API. Each payout shows its date, reference, paid amount and the fees Nexi withheld. When you choose a ReAI bank account, payouts are matched against pending bank transactions by reference or amount. Nothing is booked. You can download the reconciliation as CSV for the month end.

| Posting | Typical account |
| --- | --- |
| Clearing for online card sales | `1580` |
| Nexi fees | `7770` |
| Payout to bank | `1920` |

## Setup

1. Log in to the Nexi Checkout portal, open **Company → Integration** and copy the live secret key (it starts with `live-secret-key-`).
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the key, choose the month and optionally a bank account. The merchant number is only needed for partner keys.
4. Check the matches and download the CSV if you need it.

The key is used only for that request and is never stored.
