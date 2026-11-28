---
title: "Revolut Business & Accounting Integration"
seoTitle: "Revolut Business Accounting Integration for ReAI: Card Expenses"
description: "Fetch card payments and fees from the Revolut Business API and create one review voucher in ReAI against your Revolut bank account. Free and open source."
summary: "Fetch completed NOK card payments from Revolut Business for a period and create one balanced review voucher in ReAI."
industry: operations
webAppUrl: /app/revolut/
sourcePath: web/worker/apps/revolut/
highlights:
  - "Reads card payments and fees through the Revolut Business API with your own API key"
  - "Posts fees to account 7770 and card payments to the expense account you choose"
  - "Creates a review voucher with a duplicate check"
---

## What moves into ReAI

The integration fetches completed card payments and fees in NOK for the period you choose. Each payment is posted to the expense account you enter, and each fee to `7770`. The other side is the ReAI account for your Revolut account, for example `1925`.

| Line | Account in ReAI |
| --- | --- |
| Card payment | The expense account you choose, for example `6800` |
| Revolut fee | `7770` |
| Other side | The account for your Revolut account, for example `1925` |

Lines are posted without VAT. Set the right VAT code in ReAI when you attach the receipt, for example reverse charge for services bought abroad. Transactions in currencies other than NOK are skipped.

## Setup

1. Open the API Console at **developer.revolut.com/console**, choose **API keys** and click **New**. Give the key the permission **Accounts → Transactions → Read**.
2. Save the API key and the private signing key (`private.pem`) that the console generates.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the API key and the content of `private.pem`, choose the period and accounts, and fetch the transactions.
5. Check the preview, tick the confirmation box and create the review voucher.

The keys are used only for that request and are never stored.
