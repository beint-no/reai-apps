---
title: "Front Systems & Accounting Integration"
seoTitle: "Front Systems POS Accounting Integration for ReAI: Daily Settlements"
description: "Book Front Systems POS settlements in ReAI as review vouchers, split by payment type and VAT rate. Free and open source."
summary: "Fetch the Front Systems POS settlements for one day and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/front-systems/
sourcePath: web/worker/apps/front-systems/
highlights:
  - "Reads POS settlements through the Front Systems REST API with a subscription key and an API key"
  - "Posts sales per VAT rate with the matching ReAI output VAT code"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

The integration reads every POS settlement dated the chosen day from Front Systems, for all stores or for one store. It shows one voucher with payments on the debit side and sales per VAT rate on the credit side. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Payment types | The account set on the payment type in Front Systems, otherwise `1900` for cash and `1580` for card and Vipps |
| Sales per VAT rate | The account from the Z-report, otherwise `3000`, `3010`, `3020` or `3100`, posted including VAT with the ReAI output VAT code |

ReAI splits each sales amount into taxable base and output VAT. If payments and sales do not balance, the voucher cannot be created.

## Setup

1. Sign up at **developer.frontsystems.com**, choose a subscription and copy the **subscription key** from your profile.
2. Sign in to Front Systems Portal as a company admin, open **Admin → Integration users**, click **Create new**, choose the **Company** scope and copy the **API key**.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter both keys and the date. Leave the store empty to include every store.
5. Check the preview against the Z-report, tick the confirmation box and create the review voucher.

The keys are used only for that request and are never stored.
