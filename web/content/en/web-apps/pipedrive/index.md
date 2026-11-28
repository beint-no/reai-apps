---
title: "Pipedrive & Accounting Integration"
seoTitle: "Pipedrive Accounting Integration for ReAI: Customers and Won Deals"
description: "Turn won Pipedrive deals into ReAI draft orders ready to invoice, and create the customers that are missing. Free and open source."
summary: "Stage won Pipedrive deals as ReAI draft orders and create the missing customers."
industry: operations
webAppUrl: /app/pipedrive/
sourcePath: web/worker/apps/pipedrive/
highlights:
  - "Reads deals won since a chosen date and their organizations through the Pipedrive API with your personal API token"
  - "Checks the Norwegian organization number before the customer is created in ReAI"
  - "Creates draft orders with a fixed external reference per deal, so a deal is not invoiced twice"
---

## What moves into ReAI

The integration reads the deals won since the date you choose and the organizations they belong to. Organizations without a ReAI customer of the same name can be created as customers once you enter their organization number. If the organization number already exists in ReAI, no new customer is created. Won deals for a known customer become ReAI draft orders with the deal title, value, currency and won date.

| From Pipedrive | In ReAI |
| --- | --- |
| Organization | Customer, with the organization number you enter |
| Won deal | Draft order with one line and external reference `pipedrive-deal-<id>` |

If an order with the same external reference already exists, the integration links to it instead of creating another. Check the VAT code and amount on the order before you invoice.

## Setup

1. In Pipedrive, click your name in the top right and open **Company settings → Personal preferences → API**. Copy your personal API token.
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the token, choose the earliest won date and click **Scan Pipedrive**.
4. Create any missing customers and click **Stage order** on the won deals you want to invoice.

The token is used only for that scan and is never stored.
