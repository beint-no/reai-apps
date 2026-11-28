---
title: "Pleo Corporate Cards & Accounting"
seoTitle: "Pleo Accounting Integration for ReAI — Corporate Card Expense Import"
description: "Import Pleo expense CSV exports into balanced ReAI review vouchers mapped to NS 4102 accounts and card clearing (2380). Free with ReAI."
summary: "Turn Pleo monthly expense exports into balanced ReAI review vouchers with automatic clearing on 2380."
industry: operations
icon: icons/pleo.svg
webAppUrl: /app/pleo/
sourcePath: web/worker/apps/pleo.js
highlights:
  - "Parses Pleo accounting CSV exports (Date, Merchant, Account, Amount)"
  - "Balances every expense line against your configurable corporate card clearing account (2380)"
  - "Duplicate-checked per month and flagged for accountant review with receipt attachment"
---

## How Pleo corporate card bookkeeping works in Norway

When employees spend on Pleo cards, each receipt hits an expense account (`6xxx` / `7xxx`) while the credit side lands on a card wallet or clearing account (`2380` or `1925`). Top-ups from your main bank (`1920`) then zero out the clearing account.

| Posting | Typical Norwegian account | Notes |
| --- | --- | --- |
| Software / travel / office spend | `6900` / `7140` / `6800` (Debit) | Per receipt line from Pleo export |
| Pleo wallet / card clearing | `2380` (Credit) | Offset when topping up Pleo from `1920` |

## Step-by-step with ReAI

1. Export your approved expenses from **Pleo → Export** as CSV.
2. Click **Open integration**, connect your ReAI company, confirm your clearing account (`2380`) and drop the CSV.
3. Verify the balanced preview, create the review voucher in ReAI, and attach Pleo's receipt PDF bundle.
