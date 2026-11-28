---
title: "Provet Cloud veterinary sales and accounting"
seoTitle: "Provet Cloud to ReAI | Free open source integration for vet clinics"
description: "Fetch finalized Provet Cloud invoices for a period and create a balanced review voucher in ReAI with payments by type and sales by VAT rate."
summary: "Book Provet Cloud invoices as one ReAI review voucher per period: clinic payments, open client balances and sales by VAT rate."
industry: operations
webAppUrl: /app/provet-cloud/
sourcePath: web/worker/apps/provet-cloud/
highlights:
  - "Reads invoices, invoice rows and payments from the Provet Cloud REST API"
  - "Uses OAuth 2.0 client credentials that you request from Provet"
  - "Creates a review voucher you approve in ReAI; credentials are never stored"
---

## What moves into ReAI

The app reads issued invoices with an invoice date in the period you choose (drafts and voided invoices are skipped), their rows and the payments registered on them. It creates one review voucher in ReAI:

| Provet Cloud | ReAI account | VAT code |
| --- | --- | --- |
| Card and mobile payments | `1580` | 0 |
| Cash payments | `1900` | 0 |
| Vouchers, present cards and prepayments used | `2900` | 0 |
| Rounding payments | `7790` | 0 |
| Open balances and payments by bank, financing or consolidated invoice | `1570` | 0 |
| Rows with 25% VAT, incl. VAT | `3000` | 3 |
| Rows with 15% VAT, incl. VAT | `3010` | 31 |
| Rows with 12% VAT, incl. VAT | `3020` | 33 |
| Rows with 0% VAT | `3200` | 6 |

ReAI splits each sales line into net revenue and output VAT from the VAT code. Credit notes reduce the same accounts. The voucher is flagged for review, is only created when invoice rows add up to the invoice totals, and the same period cannot be booked twice.

## Setup

1. Fill in the **Request Sandbox and API access** form on the Provet developer site and ask for a client credentials integration for your clinic. Provet configures it and sends you a **client ID** and **client secret**.
2. Give the integration's virtual user the **Financial: Invoices** permission.
3. Copy your Provet Cloud address, for example `https://provetcloud.com/1234/`.
4. Open the app, click **Connect to ReAI** and choose the company.
5. Enter the address, client ID, client secret and period, click **Fetch from Provet Cloud API**, check the preview and create the review voucher.

The clinic currency must be NOK. Check the voucher against the Provet Cloud sales report and attach it in ReAI.
