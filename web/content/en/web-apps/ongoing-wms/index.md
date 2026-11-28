---
title: "Ongoing WMS & Accounting Integration"
seoTitle: "Ongoing WMS to ReAI: Warehouse Articles to Products"
description: "Read the articles your warehouse keeps in Ongoing WMS and create the missing ones as products in ReAI. Free and open source."
summary: "Read articles from Ongoing WMS and create missing article numbers as products in ReAI."
industry: ecommerce-logistics
webAppUrl: /app/ongoing-wms/
sourcePath: web/worker/apps/ongoing-wms/
highlights:
  - "Reads articles from the Ongoing WMS Goods Owner REST API"
  - "Compares article numbers with your ReAI products"
  - "Creates missing products with price, cost price and barcode"
---

## What the integration does

The integration reads the active articles for your goods owner from Ongoing WMS, with article number, name, customer price, purchase price, barcode and stock on hand. Article numbers are compared with your ReAI products. You can create missing articles as stock products in ReAI, one at a time. Stock levels in ReAI are not changed.

## Setup

1. Ask your warehouse for the **goods owner ID** and a goods owner API user. The warehouse creates the user under **Administration → API for goods owners** and chooses OAuth (recommended) or Basic. OAuth gives you a client ID and client secret, Basic a user name and password.
2. Find the warehouse name in the address you log in with: `https://{warehouse}.ongoingsystems.se/{warehouse}`.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the warehouse name, goods owner ID, API user type and credentials, and fetch the articles.
5. Create the missing products in ReAI.

The credentials are used only for that request and are never stored.
