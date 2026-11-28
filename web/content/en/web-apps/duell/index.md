---
title: "Duell & Accounting Integration"
seoTitle: "Duell POS Accounting Integration for ReAI: Daily Z-reports"
description: "Book Duell Z-reports in ReAI as review vouchers, using the accounts and VAT rates from your Duell account plan. Free and open source."
summary: "Fetch the Duell Z-reports for one day and create one balanced review voucher in ReAI."
industry: payments
icon: icons/duell.svg
webAppUrl: /app/duell/
sourcePath: web/worker/apps/duell.js
highlights:
  - "Reads Z-reports through the Duell API with your client number and token"
  - "Keeps the accounts from your Duell account plan and posts sales with the matching ReAI VAT code"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

The integration reads every Z-report (dagsoppgjør) dated the chosen day from the Duell API and fetches its accounting lines (GBAT10). It shows one voucher with payment lines on the debit side and sales per VAT rate on the credit side. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Cash, terminal, Vipps and other payments | The account Duell sends for each line, for example `1900` or `1580` |
| Sales per VAT rate | The sales account from Duell, posted including VAT with the ReAI output VAT code for 25 %, 15 % or 12 % |
| Rounding and other lines | The account Duell sends |

ReAI splits each sales amount into taxable base and output VAT. Card and Vipps payments stay on the clearing account until they are matched against the bank.

## Setup

1. In Duell Admin, open **System → Integrasjoner → API-oppsett** and copy the **client number** and **token**. If the menu is missing, ask Duell support to enable API access.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the client number, the token and the date. Leave the department empty to include every active department, or enter a department id or name.
4. Check the preview against the Z-report in Duell, tick the confirmation box and create the review voucher. Attach the Z-report PDF in ReAI.

The token is used only for that request and is never stored.
