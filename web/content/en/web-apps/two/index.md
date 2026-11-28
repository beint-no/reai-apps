---
title: "Two & Accounting Integration"
seoTitle: "Two Accounting Integration for ReAI: Settlement Payouts"
description: "Fetch the Two settlement report and book each payout in ReAI as a review voucher with invoice amount, fee and net payout. Free and open source."
summary: "Fetch the Two settlement report for a period and create one balanced review voucher in ReAI per payout."
industry: payments
webAppUrl: /app/two/
sourcePath: web/worker/apps/two/
highlights:
  - "Reads the settlement report through the Two API with your own API key"
  - "One voucher per payout, grouped by the Two payment reference"
  - "Creates a review voucher with a duplicate check"
---

## What moves into ReAI

The integration downloads the Two settlement report for the period you choose and groups its lines by payment reference. Only lines that Two has paid out are included. Each payout becomes one voucher:

| Line | Account in ReAI |
| --- | --- |
| Net payout | `1580`, or the account you choose, until it is matched against the bank |
| Two fee | `7770`, with input VAT when the report states VAT on the fee |
| Invoices paid out by Two, gross | `1579`, or the account where you keep the receivable on Two |

Credit notes in the report reduce the same payout. Only NOK settlements are included.

## Setup

1. Sign in to the Two Merchant Portal, open **Settings → Integration**, choose the **Production** tab and click **Create key**. Only admins can create production keys.
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the API key, choose the period and check the accounts.
4. Check each payout against the settlement report in Two, tick the confirmation box and create the review voucher.

The API key is used only for that request and is never stored.
