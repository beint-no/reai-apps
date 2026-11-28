---
title: "Paddle & Accounting Integration"
seoTitle: "Paddle Payout Accounting for ReAI"
description: "Fetch the Paddle payout reconciliation report for one payout and book sales, Paddle fees and the bank deposit in ReAI. Free and open source."
summary: "Book a Paddle Billing payout in ReAI from the payout reconciliation report, checked against the remittance advice."
industry: payments
webAppUrl: /app/paddle/
sourcePath: web/worker/apps/paddle/
highlights:
  - "Reads the payout reconciliation report through the Paddle API"
  - "Checks the report against the payout amount on the remittance advice"
  - "Creates a review voucher with sales ex. tax, fees and the bank deposit"
---

## What moves into ReAI

Paddle is the merchant of record: it sells to your customers, collects the sales tax and pays you the rest. The integration creates the payout reconciliation report for one payout in Paddle, sums every sale, refund, chargeback, fee, rebate and transfer fee in it, and checks that the total equals the payout amount you enter from the remittance advice.

The voucher is created for review in ReAI:

| Posting | Default account | VAT code |
| --- | --- | --- |
| Amount received in the bank | `1920` | `0` |
| Sales ex. tax, net of refunds | `3100` | `52` (export) |
| Paddle fees net of rebates | `7770` | `0` |

When the payout is in another currency than the company, enter the amount received in the bank. All lines are converted at that rate. The remittance reference is in the voucher text, so the same payout is not booked twice. Check the VAT treatment with your accountant.

## Setup

1. In Paddle, go to **Developer tools** and **Authentication** and create an API key with read and write access to reports.
2. Open **Payouts** in Paddle and copy the remittance reference and the amount of the payout.
3. Click **Open integration**, connect your ReAI company and enter the key, the remittance reference, the payout amount and the date on the bank statement.
4. Click **Fetch from Paddle API**. If Paddle is still preparing the report, click **Check again** after a minute.
5. Check the preview and click **Create review voucher in ReAI**. Attach the remittance advice in ReAI.

The API key is used only for this request and is never stored.
