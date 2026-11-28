---
title: "Flow Retail & Accounting Integration"
seoTitle: "Flow Retail Accounting Integration for ReAI: Daily Postings"
description: "Book the Flow Retail accounting report for one day in ReAI as a review voucher, using the accounts and VAT codes mapped in Flow Retail. Free and open source."
summary: "Fetch the Flow Retail accounting report for one day and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/flow-retail/
sourcePath: web/worker/apps/flow-retail/
highlights:
  - "Reads the daily accounting report from the Flow Retail API v2 with an integration token"
  - "Keeps the accounts and VAT codes from your Flow Retail accounting setup"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

Flow Retail aggregates each day's sales into debit and credit postings with accounts and VAT codes. The integration fetches that report for the chosen day and shows it as one voucher.

| Line | Account in ReAI |
| --- | --- |
| Cash, terminal, Vipps and other payments | The asset accounts mapped in Flow Retail |
| Sales | The revenue accounts mapped in Flow Retail |
| Rounding, cashback and receivables | The accounts Flow Retail sends |

Sales are posted including VAT with the VAT code from Flow Retail, and ReAI splits taxable base and output VAT. When Flow Retail posts VAT on its own `27xx` line, that VAT is added back to the sales with the same VAT code. Booking stays blocked unless debit equals credit.

## Setup

1. API access is included from Flow Pro. In Flow Retail Admin, go to **Users → New User**, set **Account type** to **Integration**, give the user the Reporting role and generate an integration token.
2. Find your tenant id (client) in Flow Retail Admin. You also need the organization id if you have more than one organization.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the token, the tenant id, the organization id if needed and the date, then fetch.
5. Check the preview against the accounting report in Flow Retail, tick the confirmation box and create the review voucher.

The token is used only for that request and is never stored.
