---
title: "Billetto & Accounting Integration"
seoTitle: "Billetto Accounting Integration for ReAI: Ticket Sales"
description: "Book Billetto ticket sales in ReAI as review vouchers, with revenue per VAT rate, Billetto fees and the balance held by Billetto. Free and open source."
summary: "Fetch the Billetto ledger for a period and create one balanced review voucher in ReAI."
industry: operations
webAppUrl: /app/billetto/
sourcePath: web/worker/apps/billetto/
highlights:
  - "Reads the Billetto ledger entries through the Billetto API with a key pair"
  - "Posts ticket revenue including VAT with the matching ReAI VAT code, also for tickets without VAT"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per period"
---

## What moves into ReAI

The integration reads every Billetto ledger entry in the chosen period. Ticket revenue and discounts are summed per VAT rate, and refunds and cancellations are deducted. Fees that Billetto deducts, such as payment fees, commission and invoice fees, are posted as costs. Days follow Norwegian time, and the voucher is dated the last day of the period. Nothing is booked until you check the preview and create the voucher.

| Line | Account in ReAI |
| --- | --- |
| Ticket revenue per VAT rate | `3000` (25 %), `3010` (15 %), `3020` (12 %) or `3100` (no VAT), posted including VAT with the output VAT code |
| Billetto fees | `7770`, with input VAT only when Billetto reports VAT on the fee |
| Chargebacks | `7790` |
| Balance held by Billetto | `1580` |

Billetto payouts are shown in the preview but not booked here. Match them against the bank and clearing account `1580`.

## Setup

1. In Billetto, open **Integrations → Developers → API - Key pairs** and choose **Create key pair**. Copy the ID and the secret.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the ID, the secret and the period, and fetch the ledger.
4. Check the preview against the financial report in Billetto, tick the confirmation box and create the voucher.

The key is used only for that request and is never stored.
