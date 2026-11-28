---
title: "Switch from Finago Office (24SevenOffice) to ReAI"
seoTitle: "Switch from Finago Office (24SevenOffice) to ReAI: customers, suppliers and products"
description: "Fetch customers, suppliers and products from the Finago Office API and create them in ReAI with their numbers and organization numbers."
summary: "Move customers, suppliers and products from Finago Office to ReAI."
industry: operations
webAppUrl: /app/24sevenoffice-migrate/
sourcePath: web/worker/apps/24sevenoffice-migrate.js
highlights:
  - "Reads customers, suppliers and products from the Finago Office API"
  - "Keeps customer numbers, supplier numbers, organization numbers, email addresses and prices"
  - "Skips contacts and products that already exist in ReAI"
---

## What moves into ReAI

The integration fetches customers, suppliers and products from Finago Office and lists everything before anything is sent to ReAI. You import each row with one click. When the organization number or product number already exists in ReAI, no new record is created.

| From Finago Office | In ReAI |
| --- | --- |
| Customer | Customer with the same number, organization number and email |
| Supplier | Supplier with the same number, organization number and email |
| Product | Product with the product number as SKU and the price excluding VAT |

Products get the default VAT code and revenue account in ReAI, so check them after the import. Book the opening balance from the SAF-T file in the [SAF-T tool](/app/saft/).

## Setup

1. Open **Developer** (Utvikler) at the bottom of the Finago Office menu. If it is missing, ask the Finago Office API team to enable the Developer admin panel.
2. Create an application, give it read access to customers and products, and copy the **Application ID / Client ID** and **Client Secret**.
3. Go to **Administration → Integrations**, click **Connect Application**, paste the Application ID and accept the scopes. Copy the **Organization ID** from the integration.
4. Click **Open integration**, connect ReAI and choose the company.
5. Enter the client ID, client secret and organization ID and fetch the data. Check the list and click **Import to ReAI** on the rows you want to move.

The client secret is used only for that request and is never stored.
