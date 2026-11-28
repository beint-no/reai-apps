---
title: "Lime CRM & Accounting Integration"
seoTitle: "Lime CRM Integration for ReAI: Won Deals to Orders"
description: "Read won deals from Lime CRM, create missing ReAI customers and stage each won deal as a ReAI order. Free and open source."
summary: "Read won deals and their companies from Lime CRM and create customers and orders in ReAI."
industry: operations
webAppUrl: /app/lime/
sourcePath: web/worker/apps/lime.js
highlights:
  - "Reads won deals through the Lime CRM Limeobject API with an API key"
  - "Matches the ReAI customer by organization number or name and creates it when missing"
  - "Creates one order per deal, with a duplicate check"
---

## What moves into ReAI

The integration reads deals with status **Agreement** (`agreement`) and an order date on or after the chosen date, together with the company each deal belongs to. You see the list before anything is sent to ReAI.

| From Lime CRM | In ReAI |
| --- | --- |
| Company with name and organization number | Customer, created only when you click **Create** |
| Won deal with value | Order with one line and external reference `lime-<id>` |

The order line uses the Lime CRM value as the price excluding VAT and the customer's default VAT code. Check the order in ReAI before you invoice it.

## Setup

1. Ask an administrator to create an API user in Lime CRM Server Administration (LISA) under **Databases → Security → Users** with user type **API**, then press **Create API key**. Give the user read access to companies and deals.
2. Find the address of your Lime CRM application, for example `https://company.lime-crm.com/lime-crm`. The interactive API documentation is at the same address followed by `/api/v1/docs/`.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the address and the API key, choose the date and click **Scan Lime CRM**.
5. Create missing customers and stage the orders you want to invoice.

Field names follow the standard Lime CRM data model. A customized application must still have the fields `name`, `registrationno`, `company`, `value`, `dealstatus` and `closeddate`. The API key is used only for that request and is never stored.
