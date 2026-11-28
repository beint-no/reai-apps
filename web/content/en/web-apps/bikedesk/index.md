---
title: "Bikedesk & Accounting Integration"
seoTitle: "Bikedesk POS Accounting Integration for ReAI: Day Closes"
description: "Book Bikedesk (Customers 1st) day closes in ReAI as review vouchers, with payments per payment type and sales per VAT rate. Free and open source."
summary: "Fetch the Bikedesk cash register balances for one day and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/bikedesk/
sourcePath: web/worker/apps/bikedesk/
highlights:
  - "Reads cash register balances through the Customers 1st API with an API user"
  - "Keeps the accounts set in Bikedesk and posts sales with the matching ReAI VAT code"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

The integration reads every cash register balance (Z-report) dated the chosen day from Bikedesk, which runs on Customers 1st. It shows one voucher with payments per payment type on the debit side and sales per VAT rate on the credit side. Nothing is booked until you check the preview and create the voucher.

| Line | Account in ReAI |
| --- | --- |
| Cash | The account on the payment type in Bikedesk, otherwise `1900` |
| Card, Vipps and other payments | The account on the payment type, otherwise `1580` |
| Gift card payments and gift cards sold | The account on the payment type, otherwise `2900` |
| Sales per VAT rate | The sales account from Bikedesk, otherwise `3000`, `3010`, `3020` or `3100`, posted including VAT with the output VAT code |
| Cash rounding | `7990` |

The cash difference is shown in the preview but not booked. If payments and sales do not balance, for example because customers paid invoices at the till, book that day manually from the balance report.

## Setup

1. Log in at app.c1st.com, open **Settings → API → API users**, create an API user for ReAI and copy its token.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the token and the date. Leave the cash register empty to include every register.
4. Check the preview against the balance report, tick the confirmation box and create the voucher.

The token is used only for that request and is never stored.
