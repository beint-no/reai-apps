---
title: "Nets Easy & Accounting Integration"
seoTitle: "Nets Easy / Nexi Checkout Accounting Integration for ReAI"
description: "Reconcile Nets Easy (Nexi Checkout) settlement payouts against your ReAI bank transactions for free. Complete guide for Norwegian VAT and payout fees."
summary: "Match Nets Easy / Nexi Checkout payouts against pending ReAI bank transactions and export an audit-ready CSV."
industry: payments
icon: icons/nets.svg
webAppUrl: /app/nets/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Reads Nets Easy Reporting API (/report/v1/payouts) directly by month"
  - "Matches bank deposits against Nets settlement references within an 8-day window"
  - "Included free with ReAI — zero per-connector add-on cost"
---

## How Nets Easy accounting reconciliation works

Nets Easy (Nexi Checkout) aggregates online card, Vipps and invoice payments into periodic bank settlements. Because payouts often group multiple days of sales and may deduct processing fees, clean Norwegian bookkeeping matches every settlement report against bank account `1920`.

| Accounting line | Typical Norwegian account | Notes |
| --- | --- | --- |
| Online sales (gross) | `3000` (+ VAT `2700`) | Booked from your webshop orders |
| Nets Easy clearing | `1580` | Bridges order date and bank settlement date |
| Card / payment fees | `7770` (VAT code `0`) | Financial service fee (exempt from VAT) |
| Net bank deposit | `1920` | Reconciled against Nets Easy payout batch |

## Step-by-step with ReAI

1. Copy your **Live Secret API key** from the Nets Easy / Nexi Checkout portal (ensure Reporting API access is enabled).
2. Click **Open integration**, connect your ReAI company, select your bank account and choose the month.
3. Review every matched deposit and download the reconciliation CSV as permanent voucher documentation.
