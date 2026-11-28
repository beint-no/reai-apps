---
title: "POS Daily Z-Report (Kasse Dagsoppgjør)"
seoTitle: "Norwegian POS Daily Z-Report Accounting for ReAI — Amendo, Baemingo & more"
description: "Book daily Norwegian cash register Z-reports (dagsoppgjør) into ReAI with automatic 25%, 15%, 12% and 0% VAT splitting and cash/card/Vipps balancing."
summary: "Convert any cash register Z-report (Amendo, Baemingo, Mystore POS, Kassasystem) into a balanced ReAI review voucher."
industry: payments
webAppUrl: /app/z-report/
sourcePath: web/worker/apps/z-report.js
highlights:
  - "Automatic Norwegian VAT split across 25% (3000), 15% food (3010), 12% (3020) and 0% (3100)"
  - "Balances Cash (1900), Card terminal (1580), Vipps (1580) and Gift cards (2900)"
  - "Prevents duplicate Z-report numbers and flags the voucher for accountant review"
---

## How Norwegian POS Z-report bookkeeping works

Norwegian cash register regulations (*Kassasystemlova*) require every daily Z-report (*dagsoppgjør*) to be booked cleanly by payment method and VAT rate. This app works with any compliant POS—including Amendo/ProTouch, Baemingo, Mystore POS, Quickorder and standalone terminals.

| Line | Typical Norwegian account | Description |
| --- | --- | --- |
| Cash drawer | `1900` (Debit) | Daily counted cash receipts |
| Card terminal & Vipps | `1580` (Debit) | Clearing awaiting bank settlement |
| Sales 25% / 15% / 12% / 0% | `3000` / `3010` / `3020` / `3100` (Credit) | Net sales automatically split from gross |
| Output VAT payable | `2700` (Credit) | Calculated output VAT across all rates |
| Gift cards issued | `2900` (Credit) | Prepayment liability until redeemed |

## Step-by-step with ReAI

1. Close your register for the day and read the printed or PDF **Z-report**.
2. Click **Open integration**, enter cash, card, Vipps and gross sales by VAT rate, and preview the exact double-entry voucher.
3. Verify the 0.00 balance difference, create the review voucher in ReAI, and attach your Z-report PDF.
