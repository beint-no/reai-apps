---
title: "Switch from Finago Office (24SevenOffice) to ReAI"
seoTitle: "Switch from Finago Office (24SevenOffice) to ReAI: customers, suppliers and products"
description: "Fetch customers, suppliers and products from the Finago Office API and create them in ReAI with their numbers and organization numbers."
summary: "Move customers, suppliers and products from Finago Office to ReAI."
industry: operations
webAppUrl: /app/24sevenoffice-migrate/
sourcePath: web/worker/apps/24sevenoffice-migrate/
highlights:
  - "Reads customers, suppliers and products from the Finago Office API"
  - "Keeps customer numbers, supplier numbers, organization numbers, email addresses and prices"
  - "Skips contacts and products that already exist in ReAI"
---

## What moves into ReAI

The integration fetches customers, suppliers and products from Finago Office and lists everything before anything is sent to ReAI. You import each row with one click. When the organization number, customer number or product number already exists in ReAI, no new record is created.

| From Finago Office | In ReAI |
| --- | --- |
| Customer | Customer with the same number, organization number, email, phone and postal address |
| Supplier | Supplier with the same number, organization number and email |
| Product | Product with the product number as SKU, the price excluding VAT, cost price and EAN |

Products get the default VAT code and revenue account in ReAI, so check them after the import. Book the opening balance from the SAF-T file in the [SAF-T tool](/app/saft/).

## Setup

1. Request API access from Finago with the form linked in the [Finago Office API guide](https://rest-api.developer.24sevenoffice.com/doc/v1/). Finago then enables **Developer** (Utvikler) at the bottom of the Finago Office menu.
2. Open **Developer**, create an application, add read access to customers and products, and copy the **Application ID / Client ID** and **Client Secret**.
3. Go to **Administration → Integrations**, click **Connect Application**, paste the Application ID and accept the scopes.
4. Find the organization ID: it is the Finago Client ID, the number before `@voucher.24sevenoffice.com` under **Administration → Settings → Retrieval**.
5. Click **Open integration**, connect ReAI and choose the company.
6. Enter the client ID, client secret and organization ID and fetch the data. Check the list and click **Import to ReAI** on the rows you want to move.

The client secret is used only for that request and is never stored.
