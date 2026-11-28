---
title: "TicketCo & Accounting Integration"
seoTitle: "TicketCo Accounting Integration for ReAI: Ticket Sales"
description: "Book TicketCo ticket sales in ReAI as review vouchers, with sales per VAT rate, fees and the amount due from TicketCo. Free and open source."
summary: "Fetch TicketCo transactions for a period or one event and create one balanced review voucher in ReAI."
industry: operations
webAppUrl: /app/ticketco/
sourcePath: web/worker/apps/ticketco/
highlights:
  - "Reads ticket transactions through the TicketCo Public API"
  - "Posts sales including VAT with the matching VAT code, also for tickets without VAT"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check"
---

## What moves into ReAI

The integration reads every ticket transaction in the chosen period, optionally for one event, and sums them per VAT rate. Refunds are subtracted. The voucher is dated the last day of the period. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Due from TicketCo (sales less fees) | `1580` |
| TicketCo fees | `7770`, with input VAT when TicketCo reports VAT on the fee |
| Ticket sales without VAT | `3100`, with the exempt sales code |
| Ticket sales at 25 %, 15 % or 12 % VAT | `3000`, `3010` or `3020`, posted including VAT with the output VAT code |

ReAI splits each sales amount into taxable base and VAT. The amount due stays on `1580` until the TicketCo payout is matched against the bank.

## Setup

1. Email TicketCo at **cs@ticketco.net** from the address on your TicketCo user and ask for an API token with access to transaction data (*item grosses*).
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the token, choose the period and optionally an event ID, and fetch the transactions.
4. Check the preview against the TicketCo settlement report, tick the confirmation box and create the review voucher. Attach the report in ReAI.

The token is used only for that request and is never stored.
