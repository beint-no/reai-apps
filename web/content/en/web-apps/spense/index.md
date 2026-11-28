---
title: "Spense Settlements & Accounting"
seoTitle: "Spense Settlement Reconciliation for ReAI: Payouts, Fees and Bank"
description: "Import the Spense settlement report, match each payout to the ReAI bank feed and create one review voucher for customer payments, withheld fees and payouts. Free."
summary: "Match Spense payouts against pending ReAI bank transactions and book settlements as a review voucher."
industry: payments
webAppUrl: /app/spense/
sourcePath: web/worker/apps/spense.js
highlights:
  - "Reads the documented Spense settlement CSV in the payouts or transactions format"
  - "Matches net payouts to pending ReAI bank transactions within eight days"
  - "Optional review voucher for payouts and fees withheld, with duplicate check"
---

## What moves into ReAI

Spense collects payments for workshops and dealers through payment links and terminals, deducts fees for some payment providers and pays out to your bank. The settlement report lists each payout with gross amount, fees and net amount.

The integration reads that report for one month, matches each net payout against pending bank transactions in ReAI and exports a reconciliation CSV. You can then create one balanced voucher, flagged for review:

| Posting | Default account |
| --- | --- |
| Net payout (debit) | The selected ReAI bank account |
| Fees withheld by Spense (debit) | `7770` |
| Customer payments settled by Spense (credit) | Clearing account `1580` |

Fees are booked only when the payout is lower than the gross amount. Fees that Spense invoices later are not booked here. Use the clearing account where your workshop system books invoices that customers pay through Spense.

## Setup

1. Get the settlement report from Spense as CSV in the **payouts** or **transactions** format. Spense describes both formats in its developer documentation under **Settlements**. Developers can generate the file with an API key from the Spense Portal (app.spensepay.com).
2. Click **Open integration**, connect ReAI and choose the payout month and bank account.
3. Upload the CSV, check the matches and download the reconciliation CSV if needed.
4. If the totals match the report, choose accounts and create the review voucher.

Spense offers an API, but its settlement endpoint needs a request format this web app cannot send, so the app imports the file instead.
