---
title: "webCRM & Accounting Integration"
seoTitle: "webCRM Deliveries to ReAI Orders | Free Integration"
description: "Fetch webCRM deliveries through the REST API and stage them as draft orders in ReAI, with customers created from the webCRM organisations. Free and open source."
summary: "Stage webCRM deliveries as ReAI orders and create the missing customers."
industry: operations
webAppUrl: /app/webcrm/
sourcePath: web/worker/apps/webcrm/
highlights:
  - "Reads deliveries created in a period through the webCRM REST API"
  - "Finds the organisation number in the webCRM VAT number"
  - "Stages each delivery once, with a duplicate check in ReAI"
---

## What moves into ReAI

The integration reads deliveries created in webCRM in the period you choose, together with their organisations. Organisations are matched against ReAI customers by organisation number or name, and you create the missing ones with one click. Each delivery can then be staged as a draft order in ReAI.

| From webCRM | In ReAI |
| --- | --- |
| Organisation with name, VAT number and address | Customer |
| Delivery with order value and currency | Draft order with one line |
| Delivery id | External reference that stops duplicates |

The order value is used as the price excluding VAT, and ReAI applies the customer's default VAT code. Check the order before you invoice.

## Set up webCRM with ReAI

1. In webCRM, go to **Configuration → Integration → API → REST** and create an application token. The API needs webCRM Plus or Enterprise.
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the token, choose the period and fetch.
4. Create the missing customers, fetch again and click **Stage order** for each delivery.

The token is used only for these requests and is never stored.
