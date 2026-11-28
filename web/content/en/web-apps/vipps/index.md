---
title: "Vipps & Accounting Integration"
seoTitle: "Vipps Accounting Integration for ReAI: Payout Reconciliation"
description: Reconcile Vipps MobilePay payouts against your ReAI bank feed for free. Learn how gross sales, fees and net settlements should be booked in Norway.
summary: Match Vipps MobilePay scheduled payouts with pending ReAI bank transactions and export a clean audit CSV.
industry: payments
webAppUrl: /app/vipps/
sourcePath: web/worker/apps/vipps/
highlights:
  - "Reads Vipps Report API v2 scheduled payouts directly by month"
  - "Matches payouts against pending ReAI bank transactions within an 8-day settlement window"
  - "Exports a CSV report for your month end documentation"
---

## How Vipps fits into your accounting

Vipps MobilePay often pays out the net amount after fees, or groups several days of sales into one payout. The integration fetches the scheduled payouts for one month from the Report API and matches them against pending ReAI bank transactions by amount, date and reference. Nothing is booked.

| Posting | Typical account | What to check |
| --- | --- | --- |
| Sales | `3000` or `3100` | Booked from your webshop, POS or invoice |
| Vipps clearing | `1580` | Time between sale and payout |
| Vipps fees | `7770` (VAT code `0`) | Financial service without VAT |
| Bank deposit | `1920` | Matched against the Vipps payout |

## Setup

1. Sign in at **portal.vippsmobilepay.com**, choose **For developers** and the **Production** environment. Click **Show keys** on the sales unit and copy *client_id*, *client_secret*, one *Ocp-Apim-Subscription-Key* and the MSN.
2. Click **Open integration**, connect ReAI and choose the bank account and month.
3. Check the matches and download the CSV report for your month end documentation.

The keys are used only for that request and are never stored. The Report API works with standard ePayment and Recurring keys. Sales units with a Vipps number cannot use the Report API directly.
