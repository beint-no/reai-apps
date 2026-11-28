---
title: "Vipps & Accounting Integration"
seoTitle: Vipps Accounting Integration for ReAI — Free Payout Reconciliation
description: Reconcile Vipps MobilePay payouts against your ReAI bank feed for free. Learn how gross sales, fees and net settlements should be booked in Norway.
summary: Match Vipps MobilePay scheduled payouts with pending ReAI bank transactions and export a clean audit CSV.
industry: payments
icon: icons/vipps.svg
webAppUrl: /app/vipps/
sourcePath: web/worker/apps/vipps.js
highlights:
  - "Reads Vipps Report API v2 scheduled payouts directly by month"
  - "Matches payouts against pending ReAI bank transactions within an 8-day settlement window"
  - "Zero add-on fee — free with every ReAI account, with instant sample preview"
---

## How Vipps accounting reconciliation works

Vipps MobilePay settles sales into your company bank account **net of transaction fees**—meaning the deposit arriving on bank account `1920` is lower than gross customer sales. Proper bookkeeping requires matching each bank payout against its Vipps settlement report so sales, VAT and fees stay auditable.

| Accounting line | Typical Norwegian account | What to verify |
| --- | --- | --- |
| Customer sale (gross) | `3000` / `3100` (+ VAT `2700`) | Booked from your webshop, POS or invoice |
| Vipps clearing / receivable | `1580` | Temporary balance between sale date and bank payout |
| Vipps transaction fees | `7770` (VAT code `0`) | Financial services fee deducted from payout or invoiced |
| Net bank deposit | `1920` | Matched against the scheduled Vipps payout amount |

## Step-by-step with ReAI

1. Open your Vipps MobilePay business portal and copy your sales unit's **Client ID**, **Client Secret**, **Subscription Key** and **Merchant Serial Number (MSN)**.
2. Click **Open integration** above, connect your ReAI company, select your bank account and choose the month to review.
3. Review every matched bank candidate (reference + amount, or unique amount/date match) and export the CSV as permanent voucher documentation.
