---
title: "Favrit & Accounting Integration"
seoTitle: "Favrit Accounting Integration for ReAI: Daily Sales"
description: "Book daily Favrit sales in ReAI as review vouchers, with sales per account and VAT rate, refunds and tips. Free and open source."
summary: "Fetch the Favrit orderlines for one day and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/favrit/
sourcePath: web/worker/apps/favrit/
highlights:
  - "Reads orderlines through the Favrit Orderline API with a client id and secret"
  - "Keeps the sales accounts from Favrit and posts sales with the matching ReAI output VAT code"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

The integration reads the orderlines created on the chosen day (Norwegian time) for one location. Refunds and discarded lines reduce sales on the day they happen. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Sales per account and VAT rate | The account reference from Favrit, posted including VAT with the ReAI output VAT code |
| Tips | `2930` |
| Payments | `1580` for matching against the payout in the bank |

Orderlines do not include payment fees. Book the fee when the payout reaches the bank.

## Setup

1. Sign in to Favrit admin, choose a location and open **Company Settings → Integration**.
2. Under **Developer**, choose **Integrate to Favrit**, tick **prod/transaction** and click **Create Client APP**. Copy the **ClientId** and **SecretId**.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the ClientId, the SecretId and the date. If the client covers more than one location, also enter the location id.
5. Check the preview against the sales report in Favrit, tick the confirmation box and create the review voucher.

The credentials are used only for that request and are never stored.
