---
title: "Mynt Corporate Cards & Accounting"
seoTitle: "Mynt Expense Export to ReAI: Card Purchases as a Review Voucher"
description: "Turn a Mynt expense export into one balanced ReAI review voucher with expense accounts, input VAT and a separate Mynt card account. Free and open source."
summary: "Import Mynt card expenses from the CSV export into a balanced ReAI review voucher."
industry: operations
webAppUrl: /app/mynt/
sourcePath: web/worker/apps/mynt.js
highlights:
  - "Reads the Mynt export columns Transaction date, Amount, VAT rate, Description and Account"
  - "Books 25, 15 and 12 percent input VAT and keeps refunds as credits"
  - "One review voucher per export with a duplicate check"
---

## What moves into ReAI

Mynt gives employees company cards and collects receipts, accounts and VAT for each purchase. Mynt does not offer an API key to card customers, so this integration reads the expense export that Mynt provides for accounting systems without a direct integration.

Each line becomes a row in one manual voucher, flagged for review:

| Posting | Account |
| --- | --- |
| Purchase (debit) | The Mynt **Account** column, or `6800` if empty |
| Input VAT | ReAI VAT code `1`, `11` or `13` from the Mynt **VAT rate** |
| Mynt card (credit) | Separate card account, default `1925` |

Mynt recommends a separate `19xx` ledger account for the card. Lines marked **Reverse VAT** are booked with VAT code `0` so you can set the right reverse charge code in review.

## Setup

1. In Mynt, open **Accounting & Export**, choose **Ready for Export**, select the expenses and click **Create report**.
2. Open the report under **Reports** and download it as CSV. Downloading marks the expenses as exported in Mynt.
3. Click **Open integration**, connect ReAI, enter your Mynt card account and upload the CSV.
4. Check accounts and VAT codes, create the review voucher and attach the Mynt receipts in ReAI.
