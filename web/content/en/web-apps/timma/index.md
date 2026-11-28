---
title: "Timma Salon & Booking Accounting"
seoTitle: "Timma Salon & Booking Accounting Integration for ReAI — Free"
description: "Book Timma salon, hair, beauty and wellness settlements into ReAI with exact separation of 25% treatments/retail, 0% exempt healthcare and card/booking fees."
summary: "Import Timma salon and wellness settlement reports into ReAI with automatic 25% retail/treatment vs 0% healthcare VAT split."
industry: operations
icon: icons/timma.svg
webAppUrl: /app/timma/
sourcePath: web/worker/apps/timma.js
highlights:
  - "Separates VAT-exempt healthcare treatments (3100) from 25% salon/product sales (3000 + 2700)"
  - "Books booking platform and card fees cleanly to account 7770"
  - "Creates one balanced monthly review voucher ready for accountant approval"
---

## Accounting for Norwegian salons, wellness studios and clinics

Booking platforms such as **Timma**, **Fresha**, **Fixit**, **Hano**, **Physica** and **Aspit** often combine VAT-exempt health treatments (`3100`, 0% VAT) with 25% taxable retail products (`3000` + `2700`) in the same payout settlement.

| Accounting line | Typical Norwegian account | Notes |
| --- | --- | --- |
| Net settlement clearing | `1580` (Debit) | Matches incoming payout on bank `1920` |
| Booking & payment fees | `7770` (Debit, VAT `0`) | Platform & card terminal fee |
| VAT-exempt healthcare services | `3100` (Credit) | Exempt under *Merverdiavgiftsloven § 3-2* |
| Taxable services & retail (25%) | `3000` + `2700` (Credit) | Net revenue + 25% output VAT |

## Step-by-step with ReAI

1. Export your monthly settlement summary CSV from Timma, Fresha, Fixit or your clinic system.
2. Click **Open integration**, connect your ReAI company and upload the CSV (or try the built-in sample first).
3. Verify the debit/credit split and create the review voucher in ReAI.
