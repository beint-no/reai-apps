---
title: "SuperOffice & Accounting Integration"
seoTitle: "SuperOffice CRM Accounting Integration for ReAI: Sold Sales to Invoicing"
description: "Fetch sold SuperOffice CRM sales and stage them as ReAI orders with the company and its organization number as customer. Free and open source."
summary: "Fetch sales with status Sold from SuperOffice and stage them as orders in ReAI."
industry: operations
webAppUrl: /app/superoffice/
sourcePath: web/worker/apps/superoffice/
highlights:
  - "Reads sold sales through the SuperOffice REST API"
  - "Matches the customer by organization number or name, or creates a company customer"
  - "Skips sales that are already staged"
---

## What moves into ReAI

The integration fetches sales with status *Sold* and a sale date in the chosen period, with the company name and organization number. Click **Stage in ReAI** to create a ReAI order with one line for the sale amount and the default VAT code. You review the order before invoicing.

| From SuperOffice | In ReAI |
| --- | --- |
| Heading and amount | Order line |
| Company and organization number | Customer matched by organization number or name, or a new company customer |
| Sale ID | External reference, so the sale is not staged twice |

## Setup

SuperOffice CRM Online grants API access only through access tokens from an app registered with SuperOffice, so you need such an app.

1. Register a *Custom Application* in the SuperOffice developer portal. The customer tenant needs the Development Tools licence or CRM Suite Core.
2. Sign in through the app and copy the access token and the web API URL, for example `https://online2.superoffice.com/Cust12345/api`. The token lasts one hour.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the URL, the token and the period, and fetch the sales.
5. Check the amounts and stage the orders you want to invoice.

The token is used only for that request and is never stored.
