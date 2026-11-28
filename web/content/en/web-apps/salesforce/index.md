---
title: "Salesforce & Accounting Integration"
seoTitle: "Salesforce Accounting Integration for ReAI: Won Opportunities to Invoicing"
description: "Fetch won Salesforce opportunities and stage them as ReAI orders with their products and the account as customer. Free and open source."
summary: "Fetch Closed Won opportunities and stage them as orders in ReAI."
industry: operations
webAppUrl: /app/salesforce/
sourcePath: web/worker/apps/salesforce/
highlights:
  - "Reads won opportunities through the Salesforce REST API with client credentials"
  - "One order line per opportunity product, otherwise the amount"
  - "Matches the customer by organization number or name and skips opportunities that are already staged"
---

## What moves into ReAI

The integration fetches won (*Closed Won*) opportunities with a close date in the chosen period. Click **Stage in ReAI** to create a ReAI order that you review before invoicing.

| From Salesforce | In ReAI |
| --- | --- |
| Opportunity products | Order lines with quantity and total price, with the default VAT code |
| Amount, when there are no products | One order line |
| Account | Customer matched by organization number or name, or a new company customer |
| Opportunity ID | External reference, so it is not staged twice |

Salesforce has no standard field for the Norwegian organization number. If your accounts have a custom field, enter its API name, for example `Organisasjonsnummer__c`.

## Setup

1. In Salesforce **Setup**, create an external client app (or connected app) with the OAuth scope **api**.
2. Turn on **Enable Client Credentials Flow** in the OAuth settings and choose a **Run As** user who can read opportunities and accounts.
3. Copy the **Consumer Key** and **Consumer Secret**, and find your My Domain URL under **Setup → My Domain**.
4. Click **Open integration**, connect ReAI and choose the company.
5. Enter the URL, the keys and the period, and fetch the opportunities. Multi currency orgs use the currency of each opportunity; otherwise enter your org currency.
6. Check the lines and stage the orders you want to invoice.

The keys are used only for that request and are never stored.
