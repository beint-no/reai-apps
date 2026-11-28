---
title: "Favrit & Accounting Integration"
seoTitle: "Favrit Accounting Integration for ReAI: Settlement Reports"
description: "Book Favrit settlements in ReAI as review vouchers, with sales per account and VAT rate, tips and payment fees. Free and open source."
summary: "Fetch the Favrit settlements for one day and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/favrit/
sourcePath: web/worker/apps/favrit.js
highlights:
  - "Reads settlement reports through the Favrit Accounting API with a client id and secret"
  - "Keeps the sales accounts from Favrit and posts sales with the matching ReAI output VAT code"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

The integration reads the settlements Favrit created on the chosen day for one location, with the accounting report for each settlement. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Sales per account and VAT rate | The account reference from Favrit, posted including VAT with the ReAI output VAT code |
| Delivery fee | `3000` with 25 % VAT |
| Tips | `2930` |
| Payment fees | `7770` |
| Payout from Favrit | `1580` for bank matching |

## Setup

1. Sign in to Favrit admin, choose a location and open **Company Settings → Integration**.
2. Under **Developer**, choose **Integrate to Favrit**, tick **prod/accounting** and preferably **prod/user**, and click **Create Client APP**. Copy the **ClientId** and **SecretId**.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the ClientId, the SecretId and the date. If you have more than one location, also enter the location id.
5. Check the preview against the settlement report in Favrit, tick the confirmation box and create the review voucher.

The credentials are used only for that request and are never stored.
