---
title: "Switch from PowerOffice Go to ReAI"
seoTitle: "Switch from PowerOffice Go to ReAI: customers, suppliers and products"
description: "Fetch customers, suppliers and products from the PowerOffice Go API and create them in ReAI with their numbers and organization numbers."
summary: "Move customers, suppliers and products from PowerOffice Go to ReAI."
industry: operations
webAppUrl: /app/poweroffice-migrate/
sourcePath: web/worker/apps/poweroffice-migrate.js
highlights:
  - "Reads customers, suppliers and products from the PowerOffice Go API"
  - "Keeps customer numbers, supplier numbers, organization numbers, email addresses and prices"
  - "Skips contacts and products that already exist in ReAI"
---

## What moves into ReAI

The integration fetches active customers, suppliers and products from PowerOffice Go and lists everything before anything is sent to ReAI. You import each row with one click. When the organization number or product number already exists in ReAI, no new record is created.

| From PowerOffice Go | In ReAI |
| --- | --- |
| Customer | Customer with the same number, organization number and email |
| Supplier | Supplier with the same number, organization number and email |
| Product | Product with the product number as SKU and the price excluding VAT |

Products get the default VAT code and revenue account in ReAI, so check them after the import. Book the opening balance from the SAF-T file in the [SAF-T tool](/app/saft/).

## Setup

1. Register your own integration with PowerOffice by writing to go-api@poweroffice.no. You receive an application key, and the subscription key is under **Profile** in the PowerOffice Developer Portal.
2. Activate the integration in PowerOffice Go. This gives you a client key for the company.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the subscription key, application key and client key and fetch the data.
5. Check the list and click **Import to ReAI** on the rows you want to move.

The keys are used only for that request and are never stored.
