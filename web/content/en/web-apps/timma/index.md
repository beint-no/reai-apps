---
title: "Booking, Salon & Clinic Billing (Timma / Fresha / Aspit)"
seoTitle: "Timma, Fresha & Clinic Accounting Integration for ReAI — Free Settlement Sync"
description: "Book salon, wellness and healthcare clinic settlements (Timma, Fresha, Fixit, Physica, Aspit) into ReAI with exact separation of VAT-exempt treatments and 25% retail sales."
summary: "Import Timma, Fresha, Fixit or clinic settlement CSVs with automatic 0% healthcare vs. 25% retail VAT split."
industry: operations
icon: icons/timma.svg
webAppUrl: /app/timma/
sourcePath: web/worker/apps/billing.js
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
