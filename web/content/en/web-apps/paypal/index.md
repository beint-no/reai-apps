---
title: "PayPal & Accounting Integration"
seoTitle: "PayPal Withdrawal Reconciliation for ReAI"
description: "Fetch PayPal Business withdrawals to your bank for one month and reconcile them against bank transactions in ReAI. Free and open source."
summary: "Reconcile PayPal Business withdrawals against the bank in ReAI and download the result as CSV."
industry: payments
webAppUrl: /app/paypal/
sourcePath: web/worker/apps/paypal.js
highlights:
  - "Reads bank withdrawals from the PayPal Transaction Search API"
  - "Uses your own live REST app with Transaction search turned on"
  - "Matches withdrawals against pending bank transactions in ReAI"
---

## What the integration does

The integration reads the transactions for the chosen month from the PayPal Transaction Search API and lists the withdrawals from your PayPal balance to the bank. When you choose a ReAI bank account, withdrawals are matched against pending bank transactions by reference or amount. Nothing is booked. You can download the reconciliation as CSV.

| Posting | Typical account |
| --- | --- |
| PayPal balance | `1580` or a separate PayPal account |
| PayPal fees | `7770` |
| Withdrawal to bank | `1920` |

## Setup

1. Log in to the PayPal Developer Dashboard with your business account, choose **Live** under **Apps & Credentials** and create an app.
2. Turn on **Transaction search** in the app features and copy the **Client ID** and **Secret**. Access can take a few hours to start working.
3. Click **Open integration**, connect ReAI and choose the company, the month and optionally a bank account.
4. Paste the Client ID and Secret and check the matches.

The credentials are used only for that request and are never stored.
