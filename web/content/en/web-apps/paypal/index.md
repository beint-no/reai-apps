---
title: "PayPal & Accounting Integration"
seoTitle: "PayPal Business Accounting Integration for ReAI — Free Reconciliation"
description: "Reconcile PayPal Business payouts and withdrawals against your ReAI bank feed for free. Learn how to book PayPal sales, FX fees and transfers in Norway."
summary: "Fetch PayPal Business payout withdrawals via REST Reporting API and match them against ReAI bank transactions."
industry: payments
icon: icons/paypal.svg
webAppUrl: /app/paypal/
sourcePath: web/worker/apps/paypal.js
highlights:
  - "Authenticates with PayPal REST OAuth client credentials on demand"
  - "Reads payout withdrawals and fees from PayPal Transaction Search API"
  - "Matches withdrawals against pending ReAI bank transactions and exports CSV"
---

## How PayPal bookkeeping works in Norway

A PayPal Business account acts like a separate payment wallet: customer receipts land in PayPal first, PayPal deducts transaction and currency fees, and you later transfer funds to your Norwegian bank account (`1920`).

| Accounting line | Typical Norwegian account | Notes |
| --- | --- | --- |
| PayPal wallet balance | `1930` / `1580` | Tracks balance held at PayPal |
| PayPal processing fees | `7770` (VAT code `0`) | Deducted per customer payment |
| Bank transfer from PayPal | `1920` | Matched against PayPal withdrawal events |

## Step-by-step with ReAI

1. In the **PayPal Developer Dashboard**, create a live REST app with **Transaction Search** enabled and copy Client ID + Secret.
2. Open the integration above, connect your ReAI company and choose your bank account and month.
3. Review every matched PayPal withdrawal and export the CSV for your monthly close.
