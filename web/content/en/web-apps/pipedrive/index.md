---
title: "Pipedrive & Accounting Integration"
seoTitle: "Pipedrive Accounting Integration for ReAI: Customers and Won Deals"
description: "Move Pipedrive organizations into the ReAI customer register and turn won deals into draft orders ready to invoice. Free and open source."
summary: "Move Pipedrive organizations into ReAI customers and stage won deals as ReAI draft orders."
industry: operations
webAppUrl: /app/pipedrive/
sourcePath: web/worker/apps/pipedrive/
highlights:
  - "Reads organizations and won deals through the Pipedrive API with your personal API token"
  - "Checks the Norwegian organization number before the customer is created in ReAI"
  - "Creates draft orders with a fixed external reference per deal, so a deal is not invoiced twice"
---

## What moves into ReAI

The integration reads your Pipedrive organizations and won deals. Organizations without a ReAI customer of the same name can be created as customers once you enter their organization number. Won deals for a known customer become ReAI draft orders with the deal title, value, currency and won date.

| From Pipedrive | In ReAI |
| --- | --- |
| Organization | Customer, with the organization number you enter |
| Won deal | Draft order with one line and external reference `pipedrive-deal-<id>` |

If an order with the same external reference already exists, the integration links to it instead of creating another. Check the VAT code and amount on the order before you invoice.

## Setup

1. In Pipedrive, click your name in the top right and open **Company settings → Personal preferences → API**. Copy your personal API token.
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the token and click **Scan Pipedrive**.
4. Create any missing customers and click **Stage order** on the won deals you want to invoice.

The token is used only for that scan and is never stored.
